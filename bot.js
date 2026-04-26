const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const fs = require('fs');

// ============================================================
// CONSTANTS
// ============================================================
const DB_FILE    = process.env.DB_PATH || './database.json';
const DANA_ADMIN = '085640241324';
const PREFIX     = '!';
const MIN_TARIK  = 10000;
const MIN_TOPUP  = 10000;
const C_GOLD     = 0xFFD700;
const C_GREEN    = 0x00FF7F;
const C_RED      = 0xFF4444;
const C_BLUE     = 0x00BFFF;
const C_ORANGE   = 0xFF8C00;
const C_PURPLE   = 0x9B59B6;
const C_BROWN    = 0x8B4513;
const C_TEAL     = 0x008080;

// Pajak: VIP 5%, Non-VIP 20% untuk kemenangan > 20000
const TAX_THRESHOLD = 20000;
const TAX_RATE      = 0.20;
const TAX_RATE_VIP  = 0.05;

// VIP Duration: 20 menit
const VIP_DURATION_MS = 20 * 60 * 1000;

// Uang awal saat registrasi
const STARTING_BALANCE     = 1000000; // 1.000.000 BFL
const STARTING_BALANCE_IDR = 1000;    // 1.000 IDR

// Harga Gacha Ayam
const AYAM_GACHA_PRICE = 100000;

// Harga VIP
const VIP_PRICE = 1000000; // #6: 1.000.000 BFL

// ID Kode Ayam Global (pastikan tidak ada duplikat)
// Setiap ayam Lv.1-100 memiliki 1 kode unik
const AYAM_CODES_KEY = 'ayamCodes'; // stored in db

// Role ID yang otomatis register (#10)
const AUTO_REGISTER_ROLE_NAMES = ['mod stream', 'brotherhood', 'BROTHER'];

// ============================================================
// SISTEM MAKAN/MINUM (Nyawa)
// ============================================================
const DEFAULT_FOOD_PRICE = 500;

const HUNGER_RATES = {
  tambang: 6,
  mancing:  3,
  slot:     2,
  dadu:     2,
  rain:     1,
  tip:      1,
  default:  2,
};

// ============================================================
// DATABASE - Auto-save ke file JSON
// ============================================================
function loadDB() {
  let db;
  if (!fs.existsSync(DB_FILE)) {
    db = {
      users: {},
      transactions: [],
      pendingTopup: {},
      pendingTarik: {},
      daduPending: {},
      inventory: {},
      foodConfig: {
        price: DEFAULT_FOOD_PRICE,
        name: 'Makan & Minum',
        description: 'Bekal untuk beraktivitas'
      },
      customWelcomeMsg: null,
      coupons: {},
      sabungPending: {},
      jobs: {},
      ayamCodes: {},      // #5: kode unik ayam per level
      partyCasino: null,  // #9: party casino
    };
  } else {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('DB corrupt, reset:', e.message);
      fs.unlinkSync(DB_FILE);
      return loadDB();
    }
  }

  if (!db.daduPending)      db.daduPending      = {};
  if (!db.inventory)        db.inventory        = {};
  if (!db.foodConfig)       db.foodConfig       = { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: 'Bekal untuk beraktivitas' };
  if (!db.customWelcomeMsg) db.customWelcomeMsg = null;
  if (!db.coupons)          db.coupons          = {};
  if (!db.sabungPending)    db.sabungPending    = {};
  if (!db.jobs)             db.jobs             = {};
  if (!db.ayamCodes)        db.ayamCodes        = {};
  if (!db.partyCasino)      db.partyCasino      = null;
  if (!db.tokoAyam)         db.tokoAyam         = [];
  // ROLEPLAY
  if (!db.fraksiRequests)   db.fraksiRequests   = {};  // pending join requests
  if (!db.warPending)       db.warPending       = {};  // war challenge pending acc/tolak
  if (!db.warSessions)      db.warSessions      = {};  // active war sessions
  if (!db.drugPlants)       db.drugPlants       = {};  // tanaman narkoba per user
  if (!db.adminDrugInv)     db.adminDrugInv     = { weed: 0, meth: 0 }; // rampasan
  if (!db.activeCoupon)     db.activeCoupon     = null;  // kupon custom admin
  if (!db.gameConfig)       db.gameConfig       = {     // custom WR admin
    wrJualdrug: 0.75,
    wrMancing:  0.50,
    wrTambang:  0.50,
    wrSlot:     0.50,
    wrHunt:     0.50,
    wrBonanza:  0.50,
  };

  if (process.env.ADMIN_DISCORD_ID) {
    for (const key of Object.keys(db.users)) {
      const u = db.users[key];
      if (u.noHp === DANA_ADMIN && u.discordId !== process.env.ADMIN_DISCORD_ID) {
        delete db.users[key];
      }
    }
    if (!db.users['ADMIN_' + DANA_ADMIN] || db.users['ADMIN_' + DANA_ADMIN].discordId !== process.env.ADMIN_DISCORD_ID) {
      const existing = db.users['ADMIN_' + DANA_ADMIN];
      db.users['ADMIN_' + DANA_ADMIN] = {
        discordId: process.env.ADMIN_DISCORD_ID,
        noHp: DANA_ADMIN,
        balance: existing ? existing.balance : 999999999,
        balanceIDR: existing ? (existing.balanceIDR || 0) : 0,
        registered: true,
        discordTag: 'Admin',
        registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
        isVIP: false,
        hunger: 100,
        activityCount: 0
      };
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  }

  return db;
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUserByDiscordId(db, discordId) {
  return Object.values(db.users).find(u => u.discordId === discordId);
}

function ensureUserFields(user) {
  if (user.isVIP === undefined)         user.isVIP = false;
  if (user.vipActivatedAt === undefined) user.vipActivatedAt = null;
  if (user.hunger === undefined)        user.hunger = 100;
  if (user.activityCount === undefined) user.activityCount = 0;
  if (user.chickens === undefined)      user.chickens = [];
  if (user.lastCoupon === undefined)    user.lastCoupon = null;
  if (user.balanceIDR === undefined)    user.balanceIDR = 0;
  if (user.dailyLoss === undefined)     user.dailyLoss = 0;
  if (user.dailyLossDate === undefined) user.dailyLossDate = null;
  if (user.cashbackClaimed === undefined) user.cashbackClaimed = false;
  // ROLEPLAY fields
  if (user.fraksi === undefined)       user.fraksi = null;
  if (user.senjata === undefined)      user.senjata = null;     // kode senjata aktif
  if (user.hp === undefined)           user.hp = 100;           // HP roleplay (0 = mati, butuh EMS)
  if (user.isDead === undefined)       user.isDead = false;
  if (user.kills === undefined)        user.kills = 0;
  if (user.deaths === undefined)       user.deaths = 0;
  if (user.inWar === undefined)        user.inWar = false;
  // Penjara
  if (user.jailUntil === undefined)    user.jailUntil = null;
  // Narkoba inventory
  if (user.drugInv === undefined)      user.drugInv = { weed: 0, meth: 0 };
  // Weapon inventory
  if (user.weaponInv === undefined)    user.weaponInv = {};  // { p50: 1, ak47: 2, ... }
  // Goodside gaji harian
  if (user.lastGoodGaji === undefined) user.lastGoodGaji = null;
  // Auto-expire VIP setelah 20 menit
  if (user.isVIP && user.vipActivatedAt) {
    if (Date.now() - user.vipActivatedAt > VIP_DURATION_MS) {
      user.isVIP = false;
      user.vipActivatedAt = null;
    }
  }
  return user;
}

// Tambah akumulasi kekalahan harian
function addDailyLoss(user, amount) {
  ensureUserFields(user);
  const today = new Date().toISOString().slice(0, 10);
  if (user.dailyLossDate !== today) {
    user.dailyLoss = 0;
    user.cashbackClaimed = false;
    user.dailyLossDate = today;
  }
  user.dailyLoss += amount;
}

// ============================================================
// FUNGSI NYAWA
// ============================================================
function consumeHunger(user, activityType) {
  ensureUserFields(user);
  const rate = HUNGER_RATES[activityType] || HUNGER_RATES.default;
  user.hunger = Math.max(0, user.hunger - rate);
  user.activityCount = (user.activityCount || 0) + 1;
  if (user.activityCount % 10 === 0) {
    user.hunger = Math.max(0, user.hunger - 30);
  }
}

function isStarving(user) {
  ensureUserFields(user);
  return user.hunger <= 0;
}

function hungerBar(hunger) {
  const total  = 10;
  const filled = Math.round((hunger / 100) * total);
  const empty  = total - filled;
  let emoji = '🟢';
  if (hunger <= 0)  emoji = '💀';
  else if (hunger <= 30) emoji = '🔴';
  else if (hunger <= 60) emoji = '🟡';
  return emoji + ' [' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + hunger + '%';
}

function sendToAdmin(db, amount) {
  const adminUser = getUserByDiscordId(db, process.env.ADMIN_DISCORD_ID);
  if (adminUser) adminUser.balance += amount;
}

// #6: VIP bayar pajak 5%, non-VIP 20% | #9: kemenangan > 1jt s/d 10jt pajak 50%
function applyTax(db, user, profit) {
  if (profit > TAX_THRESHOLD) {
    let rate;
    if (profit >= 1000000 && profit <= 10000000) {
      rate = 0.50; // Pajak 50% untuk menang 1jt - 10jt
    } else {
      rate = user.isVIP ? TAX_RATE_VIP : TAX_RATE;
    }
    const tax = Math.floor(profit * rate);
    user.balance -= tax;
    if (user.balance < 0) user.balance = 0;
    sendToAdmin(db, tax);
    return tax;
  }
  return 0;
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// #5: SISTEM KODE AYAM UNIK (Lv.1-100, masing-masing 1 kode)
// ============================================================
function generateAyamCode(db, level) {
  // Cek jika level sudah ada pemilik
  const code = 'AYAM' + String(level).padStart(3, '0');
  if (db.ayamCodes[code]) return null; // sudah dimiliki
  return code;
}

function releaseAyamCode(db, code) {
  if (db.ayamCodes[code]) delete db.ayamCodes[code];
}

// ============================================================
// SISTEM ROLEPLAY - FRAKSI & WAR
// ============================================================
const FRAKSI_LIST = {
  // === BADSIDE ===
  badside: {
    label: 'Badside',
    emoji: '💀',
    color: 0xFF0000,
    side: 'bad',
    desc: 'Sisi gelap kota. Penuh kejahatan, senjata, dan kekuasaan.',
  },
  mafia: {
    label: 'Mafia',
    emoji: '🕴️',
    color: 0x2C2C2C,
    side: 'bad',
    desc: 'Organisasi kriminal bawah tanah yang menguasai jalanan.',
  },
  yakuza: {
    label: 'Yakuza',
    emoji: '⚔️',
    color: 0x8B0000,
    side: 'bad',
    desc: 'Geng terorganisir dari Jepang dengan kode kehormatan.',
  },
  cartel: {
    label: 'Cartel',
    emoji: '💊',
    color: 0x8B4513,
    side: 'bad',
    desc: 'Kartel penguasa distribusi ilegal di seluruh kota.',
  },
  // [#5] Tambahan Badside: Gengster
  gengster: {
    label: 'Gengster',
    emoji: '🔪',
    color: 0x8B0000,
    side: 'bad',
    desc: 'Geng jalanan yang menguasai wilayah dengan kekerasan dan ancaman.',
  },
  // === GOODSIDE ===
  goodside: {
    label: 'Goodside',
    emoji: '⚖️',
    color: 0x0000FF,
    side: 'good',
    desc: 'Sisi terang kota. Menjaga perdamaian dan ketertiban.',
  },
  ems: {
    label: 'EMS',
    emoji: '🚑',
    color: 0x00FF7F,
    side: 'good',
    desc: 'Tim medis darurat. Mengobati korban perang dan kecelakaan.',
  },
  pemerintah: {
    label: 'Pemerintah',
    emoji: '🏛️',
    color: 0x00BFFF,
    side: 'good',
    desc: 'Penguasa resmi kota. Membuat kebijakan dan hukum.',
  },
  polisi: {
    label: 'Polisi',
    emoji: '👮',
    color: 0x0055AA,
    side: 'good',
    desc: 'Penegak hukum kota. Melindungi warga dari kriminal.',
  },
  tentara: {
    label: 'Tentara',
    emoji: '🪖',
    color: 0x556B2F,
    side: 'good',
    desc: 'Angkatan bersenjata resmi yang melindungi negara.',
  },
  // === NETRAL ===
  bfl: {
    label: 'BFL (Admin)',
    emoji: '👑',
    color: 0xFFD700,
    side: 'admin',
    desc: 'Fraksi tertinggi. Pemimpin absolut server BFL Coin.',
  },
  freelancer: {
    label: 'Freelancer',
    emoji: '🎭',
    color: 0x9B59B6,
    side: 'neutral',
    desc: 'Tidak berpihak. Bekerja untuk siapapun yang membayar.',
  },
  hacker: {
    label: 'Hacker',
    emoji: '💻',
    color: 0x00FF00,
    side: 'neutral',
    desc: 'Ahli teknologi. Bisa membantu atau menghancurkan siapapun.',
  },
  // [#2] Tambahan Netral: Civilian
  civilian: {
    label: 'Civilian',
    emoji: '🧑',
    color: 0xAAAAAA,
    side: 'neutral',
    desc: 'Warga biasa kota. Tidak berpihak, fokus pada kehidupan sehari-hari.',
  },
};

// Daftar senjata (hanya bisa dibeli Badside + Freelancer + Hacker)
const SENJATA_LIST = {
  p50:    { name: 'P50',    emoji: '🔫', harga: 100000,   damage: 1 },
  vector: { name: 'Vector', emoji: '🔫', harga: 250000,   damage: 2 },
  uzi:    { name: 'Uzi',   emoji: '🔫', harga: 195000,   damage: 2 },
  m416:   { name: 'M416',  emoji: '🪖', harga: 450000,   damage: 3 },
  ak47:   { name: 'AK47',  emoji: '💥', harga: 850000,   damage: 4 },
  kar98k: { name: 'Kar98k',emoji: '🎯', harga: 1900000,  damage: 5 },
};

// Harga EMS mengobati
const EMS_HEAL_PRICE = 100000;

// Durasi war: 2 menit = 120.000 ms
const WAR_DURATION_MS = 120000;
// Jeda antar tembakan: 20 detik (120 detik / 5 tembakan)
const WAR_SHOOT_INTERVAL = 20000;

// ============================================================
// SISTEM NARKOBA (Weed & Meth)
// ============================================================
const DRUG_LIST = {
  weed: {
    name: 'Weed',
    emoji: '🌿',
    hargaBibit: 50000,
    hargaJual: 100000,
    tumbuhMs: 10 * 60 * 1000, // 10 menit
  },
  meth: {
    name: 'Meth',
    emoji: '💎',
    hargaBibit: 35000,
    hargaJual: 75000,
    tumbuhMs: 10 * 60 * 1000,
  },
};
const DRUG_SELL_WR        = 0.75;             // 75% berhasil jual
const JAIL_DURATION       = 10 * 60 * 1000;   // 10 menit penjara (pengejaran)
const JAIL_DURATION_DRUG  = 5 * 60 * 1000;    // 5 menit penjara (gagal jual drug)
// Goodside gaji harian
const GOODSIDE_DAILY_GAJI    = 80000;
const GOODSIDE_DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 jam

// ============================================================
// CONFIG
// ============================================================
const TOKEN       = process.env.DISCORD_TOKEN;
const ADMIN_ID    = process.env.ADMIN_DISCORD_ID;
const DONATE_LINK = process.env.DONATE_LINK || 'https://saweria.co/bflcoin';

if (!TOKEN)    { console.error('ERROR: DISCORD_TOKEN belum diset!');    process.exit(1); }
if (!ADMIN_ID) { console.error('ERROR: ADMIN_DISCORD_ID belum diset!'); process.exit(1); }

// ============================================================
// CLIENT
// ============================================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
    Partials.Reaction,
  ]
});

client.once('clientReady', () => {
  console.log('Bot aktif: ' + client.user.tag);
  const db = loadDB();
  const adminEntry = db.users['ADMIN_' + DANA_ADMIN];
  if (adminEntry && adminEntry.discordId !== ADMIN_ID) {
    adminEntry.discordId = ADMIN_ID;
    adminEntry.discordTag = 'Admin';
    saveDB(db);
  }
  client.user.setActivity('!help | BFL Coin', { type: 3 });
});

// ============================================================
// #10: AUTO-REGISTER saat member bergabung / role berubah
// ============================================================
client.on('guildMemberAdd', async (member) => {
  await checkAndAutoRegister(member);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  await checkAndAutoRegister(newMember);
});

async function checkAndAutoRegister(member) {
  if (member.user.bot) return;
  const hasRole = member.roles.cache.some(r =>
    AUTO_REGISTER_ROLE_NAMES.some(name => r.name.toLowerCase() === name.toLowerCase())
  );
  if (!hasRole) return;

  const db = loadDB();
  const existing = getUserByDiscordId(db, member.id);
  if (existing) return;

  db.users['USER_' + member.id] = {
    discordId: member.id,
    discordTag: member.user.tag,
    noHp: null,
    balance: STARTING_BALANCE,
    balanceIDR: STARTING_BALANCE_IDR,
    registered: true,
    registeredAt: new Date().toISOString(),
    isVIP: false,
    hunger: 100,
    activityCount: 0,
    chickens: [],
    lastCoupon: null
  };
  saveDB(db);

  try {
    await member.send({ embeds: [
      new EmbedBuilder()
        .setTitle('Kamu Telah Otomatis Didaftarkan! 🎉')
        .setColor(C_GREEN)
        .setDescription('Karena kamu memiliki role khusus di server, kamu otomatis terdaftar di BFL Coin!')
        .addFields({ name: 'Status', value: 'Sudah di registrasi' })
    ]});
  } catch (e) {}
}

// ============================================================
// HELPER
// ============================================================
function isDMChannel(channel) { return !channel.guild; }

// ============================================================
// DATA ITEM MEMANCING & MENAMBANG
// #4: WR 50:50, hadiah tertinggi 5000-25000 BFL
// ============================================================
const FISH_TABLE = [
  { name: 'Ikan Busuk',     price: 0,     weight: 25 },
  { name: 'Ikan Kecil',     price: 500,   weight: 25 },
  { name: 'Ikan Mas',       price: 2000,  weight: 20 },
  { name: 'Ikan Kerapu',    price: 5000,  weight: 15 },
  { name: 'Ikan Tuna',      price: 10000, weight: 10 },
  { name: 'Ikan Hiu Kecil', price: 18000, weight: 4  },
  { name: 'Ikan Langka',    price: 25000, weight: 1  },
];

const MINE_TABLE = [
  { name: 'Sampah',     price: -100,  weight: 25 },
  { name: 'Batu Biasa', price: 500,   weight: 25 },
  { name: 'Bottle',     price: 2000,  weight: 20 },
  { name: 'Silver',     price: 5000,  weight: 15 },
  { name: 'Gold Ore',   price: 10000, weight: 10 },
  { name: 'Metalscrap', price: 18000, weight: 4  },
  { name: 'Berlian',    price: 25000, weight: 1  },
];

// #12: Tabel mancing/tambang IDR — maks 5000 IDR, algoritma anti-pola
// Weight di-jitter tiap sesi via weightedRandomJitter() agar tidak terpola
const FISH_TABLE_IDR = [
  { name: 'Ikan Busuk IDR',     price: 0,    weight: 34 },
  { name: 'Ikan Kecil IDR',     price: 200,  weight: 28 },
  { name: 'Ikan Mas IDR',       price: 800,  weight: 20 },
  { name: 'Ikan Kerapu IDR',    price: 2000, weight: 12 },
  { name: 'Ikan Langka IDR',    price: 5000, weight: 6  },
];

const MINE_TABLE_IDR = [
  { name: 'Sampah IDR',     price: 0,    weight: 34 },
  { name: 'Batu IDR',       price: 200,  weight: 28 },
  { name: 'Silver IDR',     price: 800,  weight: 20 },
  { name: 'Gold IDR',       price: 2000, weight: 12 },
  { name: 'Berlian IDR',    price: 5000, weight: 6  },
];

const MINE_MESSAGES = [
  '⛏️ Kamu menggali dengan sekop tua dan penuh semangat...',
  '⛏️ Kamu memukul dinding batu dengan keras, debu beterbangan...',
  '⛏️ Kamu menyusuri terowongan gelap sambil membawa lentera...',
  '⛏️ Kamu mengais bebatuan di kedalaman tambang...',
  '⛏️ Keringat mengucur deras saat kamu menambang tanpa henti...',
  '⛏️ Kamu menemukan jalur baru di dalam gua...',
];

const FISH_MESSAGES = [
  '🎣 Kamu melempar kail ke sungai yang tenang dan jernih...',
  '🎣 Kamu duduk sabar di tepi danau menunggu umpan dimakan...',
  '🎣 Kamu memancing di bawah terik matahari dengan penuh harap...',
  '🎣 Umpanmu menggoda ikan-ikan di dasar sungai yang dingin...',
  '🎣 Kamu mencoba peruntungan di sudut sungai yang dalam...',
];

function weightedRandom(table) {
  const totalWeight = table.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const item of table) {
    rand -= item.weight;
    if (rand <= 0) return { ...item };
  }
  return { ...table[table.length - 1] };
}

// Anti-pola: jitter weight ±15% secara acak lalu shuffle urutan sebelum pick
// Ini mencegah user membaca distribusi kemenangan dari pola berulang
function weightedRandomJitter(table) {
  // Shuffle Fisher-Yates dulu agar urutan tidak terprediksi
  const shuffled = [...table];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Jitter setiap weight ±15%
  const jittered = shuffled.map(item => ({
    ...item,
    weight: item.weight * (0.85 + Math.random() * 0.30)
  }));
  // Salt tambahan: buang 1 random number extra sebelum pick (buat entropy tambahan)
  Math.random();
  const totalWeight = jittered.reduce((sum, item) => sum + item.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const item of jittered) {
    rand -= item.weight;
    if (rand <= 0) return { ...item };
  }
  return { ...jittered[jittered.length - 1] };
}

function getInventory(db, userId) {
  if (!db.inventory[userId]) db.inventory[userId] = [];
  return db.inventory[userId];
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.partial) {
    try { await message.channel.fetch(); }
    catch (e) { return; }
  }

  if (!message.content.startsWith(PREFIX)) return;

  const parts   = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args    = parts;

  const db   = loadDB();
  const isDM = isDMChannel(message.channel);
  const user = getUserByDiscordId(db, message.author.id);
  if (user) ensureUserFields(user);

  console.log('[CMD] ' + message.author.tag + ' | ' + command + ' | DM=' + isDM);

  // ============================================================
  // GLOBAL DM BLOCKER
  // Command yang BOLEH di DM: help, help2, register, saldo, saldoidr, profile,
  // nyawa, topup, tarik, admincheck, dan semua admin management (DM only)
  // Semua command lain WAJIB di channel Discord server.
  // ============================================================
  const DM_ALLOWED_COMMANDS = new Set([
    'help', 'help2', 'register', 'saldo', 'saldoidr', 'profile', 'nyawa',
    'topup', 'tarik', 'topupok', 'approve', 'reject',
    'admincheck', 'adminhelp', 'addbalance', 'addbalanceidr',
    'givecoin', 'minuscoin', 'giveidr', 'allusers', 'top',
    'setmakan', 'cekfood', 'setwelcome', 'cekwelcome',
    'setwr', 'cekwr',
    'accfraksi', 'tolakfraksi', 'listrequestfraksi',
    'emsforce', 'bebasin', 'admindruginv', 'resetwar',
    'berisenjata', 'setfraksi',
    'accwar', 'tolakwar',
    'invsenjata', 'equipsenjata', 'jualsenjata',
  ]);

  if (isDM && !DM_ALLOWED_COMMANDS.has(command)) {
    return message.reply('❌ Command `!' + command + '` hanya bisa digunakan di **channel Discord server**, bukan DM!\nPergi ke server dan ketik command di sana.');
  }

  // ======================== !help ========================
  if (command === 'help') {
    if (!isDM) return message.reply('❌ Command !help hanya bisa digunakan di DM bot!\nKlik nama bot → Kirim Pesan, lalu ketik !help');

    const foodPrice = db.foodConfig ? db.foodConfig.price : DEFAULT_FOOD_PRICE;
    const foodName  = db.foodConfig ? db.foodConfig.name  : 'Makan & Minum';

    // Embed 1: Umum & Game (maks 25 fields)
    const embed1 = new EmbedBuilder()
      .setTitle('📖 BFL Coin Bot — Panduan (1/2)')
      .setColor(C_GOLD)
      .setDescription('1 BFL = 1 Rupiah Indonesia\nRegister, cek saldo & profil hanya di DM bot ini!\n`!help2` untuk halaman Roleplay & Narkoba')
      .addFields(
        { name: '📩 REGISTRASI (DM Bot)', value: '`!register` — Langsung daftar pakai username Discord!' },
        { name: '💰 CEK SALDO (DM Bot)', value: '`!saldo` — Cek saldo BFL\n`!saldoidr` — Cek saldo IDR' },
        { name: '👤 PROFIL (DM Bot)', value: '`!profile`' },
        { name: '❤️ CEK NYAWA', value: '`!nyawa` - Cek status makan & minum kamu' },
        { name: '🍱 BELI MAKAN', value: '`!beli makan` - Beli **' + foodName + '** seharga **' + foodPrice.toLocaleString('id-ID') + ' BFL**' },
        { name: '🍱 BERI MAKAN', value: '`!give makan @user` — Beri makan ke orang lain' },
        { name: '🎁 TIP', value: '`!tip @user <jumlah>`' },
        { name: '🌧️ RAIN', value: '`!rain <jumlah>` - Bagikan ke yang aktif di channel' },
        { name: '🎲 DADU 1v1', value: '`!dadu @user <taruhan>` - BFL\n`!daduidr @user <taruhan>` - IDR' },
        { name: '🎰 SLOT', value: '`!slot <taruhan>` - BFL\n`!slotidr <taruhan>` - IDR' },
        { name: '🎰 BONANZA SLOT', value: '`!bonanza <taruhan>` - Min 20.000 | Max 100.000 BFL' },
        { name: '🎣 MEMANCING', value: '`!mancing` - 500 BFL\n`!mancingidr` - 500 IDR\n`!jual ikan`\n🎁 **30% chance Lootbox (250k-550k BFL)**' },
        { name: '⛏️ MENAMBANG', value: '`!tambang` - 200 BFL\n`!tambangidr` - 200 IDR\n`!jual tambang`\n🎁 **30% chance Lootbox (250k-550k BFL)**' },
        { name: '💸 CASHBACK HARIAN', value: '`!cashback` — 10% dari total kekalahan hari ini' },
        { name: '🎮 PARTY CASINO', value: '`!party casino` | `!join casino` | `!main casino <taruhan>` | `!closecasino`' },
        { name: '🐓 SABUNG AYAM', value: '`!ayam` `!ayamku` `!tokoayam` `!jualayam` `!beliayamtoko` `!sabung`' },
        { name: '💼 KERJA', value: '`!kerja kuli` / `!kerja pizza` — 60.000 BFL | 10 menit\n`!cekkerja` | `!ambilgaji`' },
        { name: '🏹 BERBURU MONSTER', value: '`!hunt` - 800 BFL | WR 50% | 7 monster (1.000-20.000 BFL)\n`!jual monster` untuk jual hasil buruan\n🎁 **30% chance Lootbox (250k-550k BFL)**' },
        { name: '👑 VIP DEWA KERA', value: '_(Tidak tersedia)_' },
        { name: '📤 TOPUP IDR', value: '`!topup <jumlah>` - Min Rp' + MIN_TOPUP.toLocaleString('id-ID') },
        { name: '📥 TARIK IDR', value: '`!tarik <jumlah> <no_dana>` - Min Rp' + MIN_TARIK.toLocaleString('id-ID') },
        { name: '⚠️ INFO PAJAK', value: 'Non-VIP: **20%** | VIP: **5%** (untuk penghasilan > 20.000 BFL)\n⚠️ **Menang 1jt - 10jt: Pajak 50%!**' },
        { name: '❤️ DONASI', value: DONATE_LINK }
      );

    // Embed 2: Roleplay, Narkoba, Penjara
    const embed2 = new EmbedBuilder()
      .setTitle('🎭 BFL Coin Bot — Panduan (2/2) Roleplay')
      .setColor(C_RED)
      .setDescription('Sistem Roleplay — Fraksi, Perang, Narkoba, Penjara')
      .addFields(
        { name: '🏙️ FRAKSI', value: '`!fraksi` - Lihat semua fraksi\n`!joinfraksi <nama>` - Request join (perlu acc admin)\n`!rp` / `!rp @user` - Profil roleplay\n`!fraksiinfo @user` - Info fraksi user\n**Badside:** Mafia, Yakuza, Cartel, 🔪 Gengster\n**Netral:** Freelancer, Hacker, 🧑 Civilian' },
        { name: '🔫 SENJATA', value: '`!senjata` - Lihat daftar & harga\n`!senjata p50/vector/uzi/m416/ak47/kar98k` - Beli (Badside)\n`!invsenjata` - Lihat inventory senjata\n`!equipsenjata <nama>` - Pasang senjata dari inventory\n`!jualsenjata <nama> [jml]` - Jual senjata (**40% harga toko**)\n🎖️ Polisi/Tentara dapat senjata dari Admin via `!berisenjata`' },
        { name: '⚔️ PERANG', value: '`!war @user` - Tantang perang (target harus ACC dulu!)\n`!accwar` - Terima tantangan war\n`!tolakwar` - Tolak tantangan war\n`!warleaderboard` - Top kill\nPemenang dapat 20% saldo + senjata lawan masuk inventory!\n⚔️ **Badside vs Badside** atau **Badside vs Polisi/Tentara**' },
        { name: '🚑 EMS', value: '`!ems @user` - Obati yang mati (100.000 BFL dari saldo pasien)\nHanya fraksi **EMS** yang bisa!\n💀 Yang mati **tidak bisa** slot/dadu/makan/dll sampai disembuhkan EMS!' },
        { name: '💼 GAJI GOODSIDE', value: '`!gajiharian` - Klaim **80.000 BFL/hari**\nUntuk: EMS, Polisi, Pemerintah, Tentara, Goodside' },
        { name: '🌿 NARKOBA (Badside Only)', value: '`!tokodrug` - Toko bibit\n`!belibibit weed/meth <jml>` - Beli & tanam (10 menit tumbuh)\n`!cektanaman` - Status tanaman\n`!panen` - Panen hasil\n`!jualdrug weed/meth <jml>` - Jual **(WR 75%)**\n`!druginv` - Lihat inventory\n⚠️ Gagal jual = **barang disita + penjara 5 menit langsung!**' },
        { name: '🔒 PENJARA', value: '`!statuspenjara` / `!cekpenjara` - Cek hukumanmu\n❌ Di penjara: tidak bisa slot, dadu, bonanza, casino, war, jual drug\n✅ Boleh: mancing, tambang, kerja' },
        { name: '🎁 LOOTBOX', value: 'Dapatkan **Lootbox Berhadiah** saat:\n🎣 Mancing | ⛏️ Tambang | 🏹 Hunt\n📦 Chance **30%** | Hadiah **250.000 - 550.000 BFL**' },
        { name: '🎟️ KUPON (Admin)', value: '`!kupon` - Klaim kupon aktif (semua orang bisa, valid 25 menit)\n`!buatkupon` - Admin membuat kupon baru\n`!hapuskupon` - Admin hapus kupon aktif\n🎲 Hadiah: 30% Uang (50k-150k) | 70% Item' }
      );

    await message.reply({ embeds: [embed1] });
    return message.reply({ embeds: [embed2] });
  }

  // ======================== !help2 ========================
  if (command === 'help2') {
    if (!isDM) return message.reply('❌ Command !help2 hanya bisa di DM bot!');
    const embed2 = new EmbedBuilder()
      .setTitle('🎭 BFL Coin Bot — Panduan (2/2) Roleplay')
      .setColor(C_RED)
      .setDescription('Sistem Roleplay — Fraksi, Perang, Narkoba, Penjara')
      .addFields(
        { name: '🏙️ FRAKSI', value: '`!fraksi` - Lihat semua fraksi\n`!joinfraksi <nama>` - Request join (perlu acc admin)\n`!rp` / `!rp @user` - Profil roleplay\n`!fraksiinfo @user` - Info fraksi user\n**Badside:** Mafia, Yakuza, Cartel, 🔪 Gengster\n**Netral:** Freelancer, Hacker, 🧑 Civilian' },
        { name: '🔫 SENJATA', value: '`!senjata` - Lihat daftar & harga\n`!senjata p50/vector/uzi/m416/ak47/kar98k` - Beli (Badside)\n`!invsenjata` - Lihat inventory senjata\n`!equipsenjata <nama>` - Pasang senjata aktif\n`!jualsenjata <nama> [jml]` - Jual senjata (**40% harga toko**)\n🎖️ Polisi/Tentara dapat senjata dari Admin via `!berisenjata`' },
        { name: '⚔️ PERANG', value: '`!war @user` - Tantang perang\n`!accwar` - Terima tantangan war\n`!tolakwar` - Tolak tantangan war\n`!warleaderboard` - Top kill\n⚔️ **Badside vs Badside** atau **Badside vs Polisi/Tentara**\nPemenang dapat 20% saldo + senjata lawan masuk inventory!' },
        { name: '🚑 EMS', value: '`!ems @user` - Obati yang mati (100.000 BFL dari saldo pasien)\nHanya fraksi **EMS** yang bisa!\n💀 Yang mati **tidak bisa** slot/dadu/makan/dll sampai disembuhkan EMS!' },
        { name: '💼 GAJI GOODSIDE', value: '`!gajiharian` - Klaim **80.000 BFL/hari**\nUntuk: EMS, Polisi, Pemerintah, Tentara, Goodside' },
        { name: '🌿 NARKOBA (Badside Only)', value: '`!tokodrug` - Toko bibit\n`!belibibit weed/meth <jml>` - Beli & tanam (10 menit tumbuh)\n`!cektanaman` - Status tanaman\n`!panen` - Panen hasil\n`!jualdrug weed/meth <jml>` - Jual **(WR 75%)**\n`!druginv` - Lihat inventory\n⚠️ Gagal jual = **barang disita + penjara 5 menit langsung!**' },
        { name: '🔒 PENJARA', value: '`!statuspenjara` / `!cekpenjara` - Cek hukumanmu\n❌ Di penjara: tidak bisa slot, dadu, bonanza, casino, war, jual drug\n✅ Boleh: mancing, tambang, kerja' },
        { name: '🎁 LOOTBOX', value: 'Dapatkan **Lootbox Berhadiah** saat:\n🎣 Mancing | ⛏️ Tambang | 🏹 Hunt\n📦 Chance **30%** | Hadiah **250.000 - 550.000 BFL**' },
        { name: '🎟️ KUPON (Admin)', value: '`!kupon` - Klaim kupon aktif (semua orang bisa, valid 25 menit)\n`!buatkupon` - Admin membuat kupon\n🎲 Hadiah: 30% Uang (50k-150k) | 70% Item' }
      );
    return message.reply({ embeds: [embed2] });
  }

  // ======================== !register ========================
  if (command === 'register') {
    const taggedUser = message.mentions.users.first();
    if (taggedUser && message.author.id === ADMIN_ID) {
      const existingTagged = getUserByDiscordId(db, taggedUser.id);
      if (existingTagged) return message.reply(taggedUser.username + ' sudah terdaftar!');
      db.users['USER_' + taggedUser.id] = {
        discordId: taggedUser.id,
        discordTag: taggedUser.tag,
        noHp: null,
        balance: STARTING_BALANCE,
        balanceIDR: STARTING_BALANCE_IDR,
        registered: true,
        registeredAt: new Date().toISOString(),
        isVIP: false,
        hunger: 100,
        activityCount: 0,
        chickens: [],
        lastCoupon: null
      };
      saveDB(db);
      try {
        const dmEmbed = new EmbedBuilder()
          .setTitle('Kamu Telah Didaftarkan! 🎉')
          .setColor(C_GREEN)
          .setDescription('Sudah di registrasi');
        await taggedUser.send({ embeds: [dmEmbed] });
      } catch (e) {}
      return message.reply('✅ ' + taggedUser.username + ' berhasil didaftarkan!');
    }

    if (user) return message.reply('Kamu sudah terdaftar! Gunakan `!saldo` untuk cek saldo.');

    db.users['USER_' + message.author.id] = {
      discordId: message.author.id,
      discordTag: message.author.tag,
      noHp: null,
      balance: STARTING_BALANCE,
      balanceIDR: STARTING_BALANCE_IDR,
      registered: true,
      registeredAt: new Date().toISOString(),
      isVIP: false,
      hunger: 100,
      activityCount: 0,
      chickens: [],
      lastCoupon: null
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Registrasi Berhasil! 🎉')
      .setColor(C_GREEN)
      .setDescription('Sudah di registrasi');
    return message.reply({ embeds: [embed] });
  }

  // ======================== !saldo ========================
  if (command === 'saldo') {
    if (!isDM) return message.reply('❌ Command !saldo hanya bisa digunakan di DM bot!');
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);
    const embed = new EmbedBuilder()
      .setTitle('Saldo BFL Coin - ' + message.author.username)
      .setColor(C_GOLD)
      .setDescription(user.balance.toLocaleString('id-ID') + ' BFL')
      .addFields(
        { name: '💵 Saldo IDR', value: 'Rp ' + (user.balanceIDR || 0).toLocaleString('id-ID'), inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger) }
      )
      .setFooter({ text: 'Min tarik IDR: Rp' + MIN_TARIK.toLocaleString('id-ID') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !saldoidr ========================
  if (command === 'saldoidr') {
    if (!isDM) return message.reply('❌ Command ini hanya di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    return message.reply('💵 Saldo IDR kamu: **Rp ' + (user.balanceIDR || 0).toLocaleString('id-ID') + '**');
  }

  // ======================== !nyawa ========================
  if (command === 'nyawa') {
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);

    const foodConfig = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum' };
    let status = '';
    if (user.hunger <= 0)  status = '💀 **MATI KELAPARAN!** Segera beli makan!';
    else if (user.hunger <= 20) status = '😰 **Sangat Lapar!** Segera beli makan!';
    else if (user.hunger <= 50) status = '😟 **Mulai Lapar.**';
    else if (user.hunger <= 80) status = '😊 **Cukup Kenyang.**';
    else status = '😄 **Kenyang!** Kondisi prima!';

    const embed = new EmbedBuilder()
      .setTitle('❤️ Status Nyawa - ' + message.author.username)
      .setColor(user.hunger <= 0 ? C_RED : user.hunger <= 50 ? C_ORANGE : C_GREEN)
      .addFields(
        { name: 'Kondisi', value: hungerBar(user.hunger), inline: false },
        { name: 'Status', value: status, inline: false },
        { name: 'Harga Makan', value: foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !profile ========================
  if (command === 'profile') {
    if (!isDM) return message.reply('❌ Command !profile hanya bisa digunakan di DM bot!');
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);
    const vipStatus = user.isVIP ? ('👑 VIP Dewa Kera Aktif (Pajak 5%, WR +10%) — Sisa: ' + Math.max(0, Math.ceil((VIP_DURATION_MS - (Date.now() - user.vipActivatedAt)) / 60000)) + ' menit') : 'Tidak aktif';
    const embed = new EmbedBuilder()
      .setTitle('Profil - ' + message.author.username)
      .setColor(C_BLUE)
      .setThumbnail(message.author.displayAvatarURL())
      .setDescription('Sudah di registrasi')
      .addFields(
        { name: 'Saldo BFL', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Saldo IDR', value: 'Rp ' + (user.balanceIDR || 0).toLocaleString('id-ID'), inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false },
        { name: 'VIP Status', value: vipStatus, inline: true },
        { name: 'Bergabung', value: new Date(user.registeredAt).toLocaleDateString('id-ID'), inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !beli ========================
  if (command === 'beli') {
    const subCmd = args[0]?.toLowerCase();

    // --- Beli Makan ---
    if (subCmd === 'makan') {
      if (!user) return message.reply('Belum terdaftar!');
      ensureUserFields(user);
      // User yang mati TIDAK bisa beli makan (harus EMS dulu)
      if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Kamu harus disembuhkan oleh EMS dulu sebelum bisa beraktivitas.\n`!ems @kamu` — Minta anggota EMS untuk mengobatimu (biaya 100.000 BFL)');
      const foodConfig = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: 'Bekal untuk beraktivitas' };
      if (user.hunger >= 100) return message.reply('❤️ Nyawa sudah penuh (100%)!');
      if (user.balance < foodConfig.price) return message.reply('❌ Saldo tidak cukup! Harga: ' + foodConfig.price.toLocaleString('id-ID') + ' BFL');
      const nyawaSebelum = user.hunger;
      user.balance -= foodConfig.price;
      user.hunger   = 100;
      sendToAdmin(db, foodConfig.price);
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('🍱 ' + foodConfig.name + ' Dibeli!')
        .setColor(C_GREEN)
        .setDescription('*' + (foodConfig.description || 'Bekal untuk beraktivitas') + '*')
        .addFields(
          { name: '🛒 Item', value: foodConfig.name, inline: true },
          { name: '💰 Harga', value: '-' + foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '❤️ Nyawa Sebelum', value: hungerBar(nyawaSebelum), inline: false },
          { name: '❤️ Nyawa Sekarang', value: hungerBar(100), inline: false },
          { name: '📋 Info', value: 'Nyawa berkurang setiap aktivitas. Beli makan lagi jika nyawa habis.', inline: false }
        )
        .setFooter({ text: 'Nyawa 0% = tidak bisa beraktivitas!' });
      return message.reply({ embeds: [embed] });
    }

    // --- Beli VIP (DIHAPUS) ---
    if (subCmd === 'vip') {
      return message.reply('❌ Pembelian VIP saat ini tidak tersedia.');
    }

    return message.reply('Format: `!beli makan`');
  }

  // ======================== !tip ========================
  if (command === 'tip') {
    if (isDM) return message.reply('Command !tip hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('Format: `!tip @user <jumlah>`');
    if (target.id === message.author.id) return message.reply('Tidak bisa tip ke diri sendiri!');
    if (target.bot) return message.reply('Tidak bisa tip ke bot!');
    if (user.balance < amount) return message.reply('Saldo tidak cukup!');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    user.balance -= amount;
    targetUser.balance += amount;
    consumeHunger(user, 'tip');
    db.transactions.push({ type: 'tip', from: message.author.id, to: target.id, amount, timestamp: new Date().toISOString() });
    saveDB(db);
    const embedTip = new EmbedBuilder()
      .setTitle('🎁 Tip Berhasil Dikirim!')
      .setColor(C_GREEN)
      .setDescription('**' + message.author.username + '** mengirim tip kepada **' + target.username + '**!')
      .addFields(
        { name: '💸 Jumlah Tip', value: amount.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '📤 Pengirim', value: message.author.username, inline: true },
        { name: '📥 Penerima', value: target.username, inline: true },
        { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
      );
    return message.reply({ embeds: [embedTip] });
  }

  // ======================== !rain / !party ========================
  // Catatan: !party casino ditangani terpisah di bawah
  if (command === 'rain' || (command === 'party' && args[0]?.toLowerCase() !== 'casino')) {
    if (isDM) return message.reply('Command !rain hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('Format: `!rain <jumlah>`');
    if (user.balance < amount) return message.reply('Saldo tidak cukup!');
    const msgs = await message.channel.messages.fetch({ limit: 50 });
    const seen = {};
    const activeAuthors = [];
    msgs.forEach(m => {
      if (!m.author.bot && m.author.id !== message.author.id && !seen[m.author.id]) {
        seen[m.author.id] = true;
        activeAuthors.push(m.author);
      }
    });
    const eligible = activeAuthors.filter(a => getUserByDiscordId(db, a.id));
    if (eligible.length === 0) return message.reply('Tidak ada user aktif yang terdaftar!');
    const perPerson = Math.floor(amount / eligible.length);
    if (perPerson < 1) return message.reply('Jumlah terlalu kecil untuk dibagi ' + eligible.length + ' orang!');
    user.balance -= perPerson * eligible.length;
    eligible.forEach(a => { const u = getUserByDiscordId(db, a.id); u.balance += perPerson; });
    consumeHunger(user, 'rain');
    saveDB(db);
    const mentions = eligible.map(a => '<@' + a.id + '>').join(' ');
    const totalDibagi = perPerson * eligible.length;
    const embedRain = new EmbedBuilder()
      .setTitle('🌧️ RAIN BFL Coin!')
      .setColor(C_GOLD)
      .setDescription('**' + message.author.username + '** membagikan hujan koin kepada ' + eligible.length + ' orang!')
      .addFields(
        { name: '💰 Total Dibagikan', value: totalDibagi.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '👥 Jumlah Penerima', value: eligible.length + ' orang', inline: true },
        { name: '🎁 Per Orang', value: perPerson.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '🌧️ Penerima', value: mentions.slice(0, 800) },
        { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
      );
    return message.reply({ embeds: [embedRain] });
  }

  // ======================== !dadu ========================
  if (command === 'dadu') {
    if (isDM) return message.reply('Command !dadu hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    const target = message.mentions.users.first();
    const bet    = parseInt(args[1]);
    if (!target || isNaN(bet) || bet <= 0) return message.reply('Format: `!dadu @user <taruhan>`');
    if (target.bot || target.id === message.author.id) return message.reply('Target tidak valid!');
    if (user.balance < bet) return message.reply('Saldo BFL tidak cukup!');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    if (targetUser.balance < bet) return message.reply(target.username + ' tidak punya saldo BFL cukup!');
    if (db.daduPending[target.id]) return message.reply(target.username + ' masih punya tantangan dadu!');
    db.daduPending[target.id] = { challengerId: message.author.id, challengerTag: message.author.tag, bet, currency: 'BFL', channelId: message.channel.id, timestamp: Date.now() };
    saveDB(db);
    const embed = new EmbedBuilder()
      .setTitle('Tantangan Dadu! 🎲')
      .setColor(C_ORANGE)
      .setDescription('<@' + target.id + '>! **' + message.author.username + '** mengajakmu adu dadu!\nTaruhan: **' + bet.toLocaleString('id-ID') + ' BFL**')
      .addFields({ name: 'Jawab dengan', value: '`!acc` untuk terima\n`!cancel` untuk tolak' })
      .setFooter({ text: 'Expired dalam 2 menit' });
    await message.reply({ embeds: [embed] });
    setTimeout(() => {
      const dbNow = loadDB();
      if (dbNow.daduPending[target.id] && dbNow.daduPending[target.id].challengerId === message.author.id) {
        delete dbNow.daduPending[target.id];
        saveDB(dbNow);
        message.channel.send('<@' + target.id + '> Tantangan dadu expired!').catch(() => {});
      }
    }, 2 * 60 * 1000);
    return;
  }

  // ======================== !daduidr (#12: dadu IDR) ========================
  if (command === 'daduidr') {
    if (isDM) return message.reply('Command !daduidr hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    const target = message.mentions.users.first();
    const bet    = parseInt(args[1]);
    if (!target || isNaN(bet) || bet <= 0) return message.reply('Format: `!daduidr @user <taruhan>`');
    if (target.bot || target.id === message.author.id) return message.reply('Target tidak valid!');
    if ((user.balanceIDR || 0) < bet) return message.reply('Saldo IDR tidak cukup!');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    ensureUserFields(targetUser);
    if ((targetUser.balanceIDR || 0) < bet) return message.reply(target.username + ' tidak punya saldo IDR cukup!');
    if (db.daduPending[target.id]) return message.reply(target.username + ' masih punya tantangan dadu!');
    db.daduPending[target.id] = { challengerId: message.author.id, challengerTag: message.author.tag, bet, currency: 'IDR', channelId: message.channel.id, timestamp: Date.now() };
    saveDB(db);
    const embed = new EmbedBuilder()
      .setTitle('Tantangan Dadu IDR! 🎲💵')
      .setColor(C_ORANGE)
      .setDescription('<@' + target.id + '>! **' + message.author.username + '** mengajakmu adu dadu!\nTaruhan: **Rp ' + bet.toLocaleString('id-ID') + ' IDR**')
      .addFields({ name: 'Jawab dengan', value: '`!acc` untuk terima\n`!cancel` untuk tolak' })
      .setFooter({ text: 'Expired dalam 2 menit' });
    await message.reply({ embeds: [embed] });
    setTimeout(() => {
      const dbNow = loadDB();
      if (dbNow.daduPending[target.id] && dbNow.daduPending[target.id].challengerId === message.author.id) {
        delete dbNow.daduPending[target.id];
        saveDB(dbNow);
        message.channel.send('<@' + target.id + '> Tantangan dadu IDR expired!').catch(() => {});
      }
    }, 2 * 60 * 1000);
    return;
  }

  // ======================== !acc ========================
  if (command === 'acc') {
    if (isDM) return message.reply('Command !acc hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const pending = db.daduPending[message.author.id];
    if (!pending) return message.reply('Kamu tidak punya tantangan dadu yang menunggu!');

    const challenger = getUserByDiscordId(db, pending.challengerId);
    if (!challenger) {
      delete db.daduPending[message.author.id];
      saveDB(db);
      return message.reply('Penantang tidak ditemukan!');
    }
    ensureUserFields(challenger);

    const bet      = pending.bet;
    const currency = pending.currency || 'BFL';

    if (currency === 'IDR') {
      if ((challenger.balanceIDR || 0) < bet || (user.balanceIDR || 0) < bet) {
        delete db.daduPending[message.author.id];
        saveDB(db);
        return message.reply('Saldo IDR salah satu pihak tidak cukup. Dibatalkan.');
      }
    } else {
      if (challenger.balance < bet || user.balance < bet) {
        delete db.daduPending[message.author.id];
        saveDB(db);
        return message.reply('Saldo tidak cukup. Dibatalkan.');
      }
    }

    const diceA = Math.floor(Math.random() * 6) + 1;
    const diceB = Math.floor(Math.random() * 6) + 1;
    let resultText = '';
    let taxAmount = 0;

    if (diceA > diceB) {
      if (currency === 'IDR') {
        challenger.balanceIDR = (challenger.balanceIDR || 0) + bet;
        user.balanceIDR = (user.balanceIDR || 0) - bet;
        // Kekalahan IDR masuk admin
        const adminDadu = getUserByDiscordId(db, ADMIN_ID);
        if (adminDadu) { ensureUserFields(adminDadu); adminDadu.balanceIDR = (adminDadu.balanceIDR || 0) + bet; }
      } else {
        challenger.balance += bet; user.balance -= bet;
        // #9: Pajak 50% jika menang 1jt - 10jt
        if (bet >= 1000000 && bet <= 10000000) {
          const bigTax = Math.floor(bet * 0.50);
          challenger.balance -= bigTax;
          sendToAdmin(db, bigTax);
          taxAmount = bigTax;
        } else {
          taxAmount = applyTax(db, challenger, bet);
        }
        addDailyLoss(user, bet);
      }
      resultText = '<@' + pending.challengerId + '> **MENANG**! 🏆';
    } else if (diceB > diceA) {
      if (currency === 'IDR') {
        user.balanceIDR = (user.balanceIDR || 0) + bet;
        challenger.balanceIDR = (challenger.balanceIDR || 0) - bet;
        const adminDadu2 = getUserByDiscordId(db, ADMIN_ID);
        if (adminDadu2) { ensureUserFields(adminDadu2); adminDadu2.balanceIDR = (adminDadu2.balanceIDR || 0) + bet; }
      } else {
        user.balance += bet; challenger.balance -= bet;
        // #9: Pajak 50% jika menang 1jt - 10jt
        if (bet >= 1000000 && bet <= 10000000) {
          const bigTax = Math.floor(bet * 0.50);
          user.balance -= bigTax;
          sendToAdmin(db, bigTax);
          taxAmount = bigTax;
        } else {
          taxAmount = applyTax(db, user, bet);
        }
        addDailyLoss(challenger, bet);
      }
      resultText = '<@' + message.author.id + '> **MENANG**! 🏆';
    } else {
      resultText = '**SERI!** 🤝 Taruhan dikembalikan ke masing-masing pemain.';
    }

    consumeHunger(user, 'dadu');
    consumeHunger(challenger, 'dadu');
    delete db.daduPending[message.author.id];
    db.transactions.push({ type: 'dadu', currency, playerA: pending.challengerId, playerB: message.author.id, bet, diceA, diceB, timestamp: new Date().toISOString() });
    saveDB(db);

    const isDraw = diceA === diceB;
    const winnerTag = diceA > diceB ? (challenger.discordTag || 'Penantang') : message.author.username;
    const embedDadu = new EmbedBuilder()
      .setTitle('🎲 Adu Dadu — Hasil!')
      .setColor(isDraw ? C_BLUE : C_GOLD)
      .setDescription(isDraw ? '🤝 **SERI!** Taruhan dikembalikan.' : '🏆 **' + winnerTag + '** MENANG!')
      .addFields(
        { name: '🎲 ' + (challenger.discordTag || 'Penantang'), value: '**' + diceA + '**', inline: true },
        { name: 'VS', value: '———', inline: true },
        { name: '🎲 ' + message.author.username, value: '**' + diceB + '**', inline: true },
        { name: '💰 Taruhan', value: bet.toLocaleString('id-ID') + (currency === 'IDR' ? ' IDR' : ' BFL'), inline: true },
        { name: isDraw ? '↩️ Dikembalikan' : '🏆 Pemenang Dapat', value: isDraw ? 'Masing-masing ' + bet.toLocaleString('id-ID') + (currency === 'IDR' ? ' IDR' : ' BFL') : bet.toLocaleString('id-ID') + (currency === 'IDR' ? ' IDR' : ' BFL'), inline: true },
        { name: '🏛️ Pajak', value: taxAmount > 0 ? '-' + taxAmount.toLocaleString('id-ID') + ' BFL (' + (user.isVIP || challenger.isVIP ? '5%' : '20%') + ')' : 'Bebas pajak', inline: true },
        { name: '❤️ Nyawa ' + message.author.username, value: hungerBar(user.hunger), inline: true },
        { name: '❤️ Nyawa ' + (challenger.discordTag || 'Penantang'), value: hungerBar(challenger.hunger), inline: true }
      );
    return message.reply({ embeds: [embedDadu] });
  }

  // ======================== !cancel ========================
  if (command === 'cancel') {
    if (isDM) return message.reply('Command !cancel hanya bisa di server!');
    const pending = db.daduPending[message.author.id];
    if (!pending) return message.reply('Kamu tidak punya tantangan dadu yang menunggu!');
    delete db.daduPending[message.author.id];
    saveDB(db);
    return message.reply('<@' + message.author.id + '> menolak tantangan dadu dari <@' + pending.challengerId + '>!');
  }

  // ======================== !slot ========================
  if (command === 'slot') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!slot <taruhan>`');
    if (user.balance < bet) return message.reply('Saldo BFL tidak cukup!');

    // WR configurable via !setwr, VIP +10%, Admin 85%
    const wrSlot = (db.gameConfig && db.gameConfig.wrSlot != null) ? db.gameConfig.wrSlot : 0.50;
    const winChance = message.author.id === ADMIN_ID ? 0.85 : (user.isVIP ? Math.min(wrSlot + 0.10, 0.95) : wrSlot);

    // Tabel multiplier — weight adalah proporsi dari bagian kemenangan (total=100)
    const slotMultTable = [
      { mult: 1.5, weight: 40 },
      { mult: 2.0, weight: 30 },
      { mult: 2.5, weight: 20 },
      { mult: 3.0, weight: 10 },
    ];

    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    // Anti-pola: dua lapis RNG + salt sebelum keputusan menang/kalah
    Math.random(); // entropy salt
    const roll1 = Math.random();
    const roll2 = Math.random();
    const finalRoll = (roll1 + roll2) / 2; // rata-rata dua roll → distribusi lebih halus

    let multiplier = 0;
    if (finalRoll < winChance) {
      // Pilih multiplier dengan jitter anti-pola
      const jitteredMult = slotMultTable.map(t => ({
        ...t, weight: t.weight * (0.85 + Math.random() * 0.30)
      }));
      Math.random(); // salt tambahan
      const totalW = jitteredMult.reduce((s, t) => s + t.weight, 0);
      let r = Math.random() * totalW;
      for (const t of jitteredMult) { r -= t.weight; if (r <= 0) { multiplier = t.mult; break; } }
      if (multiplier === 0) multiplier = 1.5;
      spin[1] = spin[0];
    }

    const won    = Math.floor(bet * multiplier);
    const profit = won - bet;
    user.balance += profit;
    if (user.balance < 0) user.balance = 0;
    if (profit < 0) { sendToAdmin(db, Math.abs(profit)); addDailyLoss(user, Math.abs(profit)); }
    let taxAmount = 0;
    if (profit > 0) taxAmount = applyTax(db, user, profit);
    consumeHunger(user, 'slot');
    saveDB(db);

    const line = '[ ' + spin.join(' | ') + ' ]';
    const slotEmbed = new EmbedBuilder()
      .setTitle('🎰 SLOT MACHINE' + (user.isVIP ? ' 👑 VIP' : ''))
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription('**' + line + '**\n\n' + (multiplier > 0 ? '🎉 **MENANG x' + multiplier + '!**' : '😞 **Tidak ada kombinasi — Kalah**'))
      .addFields(
        { name: '🎯 Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: multiplier > 0 ? '💵 Kemenangan Kotor' : '💸 Kerugian', value: multiplier > 0 ? won.toLocaleString('id-ID') + ' BFL' : bet.toLocaleString('id-ID') + ' BFL hangus', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
      );
    if (multiplier > 0) {
      slotEmbed.addFields(
        { name: '📈 Profit Bersih', value: '+' + profit.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '🏛️ Pajak', value: taxAmount > 0 ? '-' + taxAmount.toLocaleString('id-ID') + ' BFL (' + (user.isVIP ? '5%' : '20%') + ')' : 'Bebas pajak', inline: true },
        { name: '\u200B', value: '\u200B', inline: true }
      );
    } else {
      slotEmbed.addFields(
        { name: '📉 Total Rugi', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '💡 Tip', value: 'Coba lagi! Gunakan `!cashback` jika rugi banyak.', inline: false }
      );
    }
    slotEmbed.addFields({ name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false });
    slotEmbed.setFooter({ text: 'WR: ' + (user.isVIP ? '60%' : '50%') + ' | Multiplier: 1.5x – 3x' });
    return message.reply({ embeds: [slotEmbed] });
  }

  // ======================== !slotidr (Slot IDR WR 30:70) ========================
  if (command === 'slotidr') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!slotidr <taruhan>`');
    if ((user.balanceIDR || 0) < bet) return message.reply('Saldo IDR tidak cukup!');

    // WR configurable via !setwr, VIP +10%, Admin 85%
    const wrSlotIDR = (db.gameConfig && db.gameConfig.wrSlot != null) ? db.gameConfig.wrSlot : 0.50;
    const winChance = message.author.id === ADMIN_ID ? 0.85 : (user.isVIP ? Math.min(wrSlotIDR + 0.10, 0.95) : wrSlotIDR);

    const slotMultTable = [
      { mult: 1.5, weight: 40 },
      { mult: 2.0, weight: 30 },
      { mult: 2.5, weight: 20 },
      { mult: 3.0, weight: 10 },
    ];

    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    // Anti-pola: dua lapis RNG
    Math.random();
    const rollA = Math.random();
    const rollB = Math.random();
    const finalRollIDR = (rollA + rollB) / 2;

    let multiplier = 0;
    if (finalRollIDR < winChance) {
      const jitteredMult = slotMultTable.map(t => ({
        ...t, weight: t.weight * (0.85 + Math.random() * 0.30)
      }));
      Math.random();
      const totalW = jitteredMult.reduce((s, t) => s + t.weight, 0);
      let r = Math.random() * totalW;
      for (const t of jitteredMult) { r -= t.weight; if (r <= 0) { multiplier = t.mult; break; } }
      if (multiplier === 0) multiplier = 1.5;
      spin[1] = spin[0];
    }

    const won    = Math.floor(bet * multiplier);
    const profit = won - bet;
    user.balanceIDR = (user.balanceIDR || 0) + profit;
    if (user.balanceIDR < 0) user.balanceIDR = 0;
    // Kekalahan IDR masuk admin
    if (profit < 0) {
      const adminUser = getUserByDiscordId(db, ADMIN_ID);
      if (adminUser) { ensureUserFields(adminUser); adminUser.balanceIDR = (adminUser.balanceIDR || 0) + Math.abs(profit); }
      addDailyLoss(user, Math.abs(profit));
    }
    consumeHunger(user, 'slot');
    saveDB(db);

    const line = '[ ' + spin.join(' | ') + ' ]';
    const wonIDR = Math.floor(bet * multiplier);
    const profitIDR = wonIDR - bet;
    const slotIDREmbed = new EmbedBuilder()
      .setTitle('🎰 SLOT IDR 💵' + (user.isVIP ? ' 👑 VIP' : ''))
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription('**' + line + '**\n\n' + (multiplier > 0 ? '🎉 **MENANG x' + multiplier + '!**' : '😞 **Tidak ada kombinasi — Kalah**'))
      .addFields(
        { name: '🎯 Taruhan', value: 'Rp ' + bet.toLocaleString('id-ID'), inline: true },
        { name: multiplier > 0 ? '💵 Kemenangan Kotor' : '💸 Kerugian', value: multiplier > 0 ? 'Rp ' + wonIDR.toLocaleString('id-ID') : 'Rp ' + bet.toLocaleString('id-ID') + ' hangus', inline: true },
        { name: '\u200B', value: '\u200B', inline: true }
      );
    if (multiplier > 0) {
      slotIDREmbed.addFields(
        { name: '📈 Profit Bersih', value: '+Rp ' + profitIDR.toLocaleString('id-ID'), inline: true },
        { name: '🏛️ Pajak', value: 'Tidak dikenai pajak (IDR)', inline: true },
        { name: '\u200B', value: '\u200B', inline: true }
      );
    } else {
      slotIDREmbed.addFields(
        { name: '📉 Total Rugi', value: 'Rp ' + bet.toLocaleString('id-ID'), inline: true },
        { name: '💡 Tip', value: 'Coba `!cashback` untuk klaim cashback 30%.', inline: false }
      );
    }
    slotIDREmbed.addFields({ name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false });
    slotIDREmbed.setFooter({ text: 'WR: ' + (user.isVIP ? '60%' : '50%') + ' | Multiplier: 1.5x – 3x' });
    return message.reply({ embeds: [slotIDREmbed] });
  }

  // ======================== !bonanza (Min 20k, Max 100k, maks x50) ========================
  if (command === 'bonanza') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const BONANZA_MIN = 20000;
    const BONANZA_MAX = 1000000;

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!bonanza <taruhan>`\nMin: **20.000 BFL** | Max: **1.000.000 BFL**');
    if (bet < BONANZA_MIN) return message.reply('❌ Taruhan minimal Bonanza: **20.000 BFL**');
    if (bet > BONANZA_MAX) return message.reply('❌ Taruhan maksimal Bonanza: **1.000.000 BFL**');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const isAdminPlayer = message.author.id === ADMIN_ID;

    // WR configurable via !setwr bonanza, default 50%
    const wrBonanzaBase = (db.gameConfig && db.gameConfig.wrBonanza != null) ? db.gameConfig.wrBonanza * 100 : 50;
    const wrBonanzaVIP  = Math.min(wrBonanzaBase + 10, 95);
    const bonanzaKalah  = 100 - wrBonanzaBase;
    const bonanzaKalahVIP = 100 - wrBonanzaVIP;
    // Distribusi menang proporsional
    const bonanzaWinTotal = wrBonanzaBase;
    const baseTable = [
      { mult: 1.5, wr: bonanzaWinTotal * 0.54 },
      { mult: 2.5, wr: bonanzaWinTotal * 0.27 },
      { mult: 5,   wr: bonanzaWinTotal * 0.135},
      { mult: 50,  wr: bonanzaWinTotal * 0.055},
      { mult: 0,   wr: bonanzaKalah },
    ];

    const bonanzaWinVIP = wrBonanzaVIP;
    const vipTable = [
      { mult: 1.5, wr: bonanzaWinVIP * 0.54 },
      { mult: 2.5, wr: bonanzaWinVIP * 0.27 },
      { mult: 5,   wr: bonanzaWinVIP * 0.135},
      { mult: 50,  wr: bonanzaWinVIP * 0.055},
      { mult: 0,   wr: bonanzaKalahVIP },
    ];

    const adminTable = [
      { mult: 1.5, wr: 30 },
      { mult: 2.5, wr: 30 },
      { mult: 5,   wr: 25 },
      { mult: 50,  wr: 15 },
    ];

    let activeTable;
    if (isAdminPlayer)  activeTable = adminTable;
    else if (user.isVIP) activeTable = vipTable;
    else                 activeTable = baseTable;

    // Anti-pola: jitter weight ±15%, dua lapis RNG, salt ganda
    Math.random(); // entropy salt 1
    Math.random(); // entropy salt 2
    const jitteredTable = activeTable.map(t => ({
      ...t, weight: t.wr * (0.85 + Math.random() * 0.30)
    }));
    // Shuffle Fisher-Yates
    for (let i = jitteredTable.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jitteredTable[i], jitteredTable[j]] = [jitteredTable[j], jitteredTable[i]];
    }
    Math.random(); // entropy salt 3

    const totalW = jitteredTable.reduce((s, t) => s + t.weight, 0);
    // Dua lapis roll, rata-rata untuk distribusi lebih halus
    const r1 = Math.random() * totalW;
    const r2 = Math.random() * totalW;
    let chosenMult = 0;
    let r = (r1 + r2) / 2;
    // Re-normalize karena rata-rata
    const halfTotal = totalW / 2;
    r = Math.random() * totalW; // pakai satu roll fresh setelah salt
    for (const t of jitteredTable) { r -= t.weight; if (r <= 0) { chosenMult = t.mult; break; } }

    // Visual grid bonanza
    const bonanzaSymbols = ['💎', '🔴', '🟢', '🔵', '🟡', '🟣', '⭐', '🎰'];
    const grid = [];
    for (let i = 0; i < 6; i++) grid.push(bonanzaSymbols[Math.floor(Math.random() * bonanzaSymbols.length)]);

    // Kalau menang, paksa ada 3+ match untuk tampilan
    if (chosenMult > 0) {
      const winSym = bonanzaSymbols[Math.floor(Math.random() * bonanzaSymbols.length)];
      grid[0] = winSym; grid[1] = winSym; grid[2] = winSym;
    }

    const won    = Math.floor(bet * chosenMult);
    const profit = won - bet;
    user.balance += profit;
    if (user.balance < 0) user.balance = 0;
    if (profit < 0) { sendToAdmin(db, Math.abs(profit)); addDailyLoss(user, Math.abs(profit)); }
    let taxBonanza = 0;
    if (profit > 0) taxBonanza = applyTax(db, user, profit);
    consumeHunger(user, 'slot');
    saveDB(db);

    const gridDisplay = grid.join(' ');
    const wonBonanza = Math.floor(bet * chosenMult);
    const profitBonanza = wonBonanza - bet;
    const bonanzaTitleText = chosenMult === 50 ? '🔥 JACKPOT x50!!' : chosenMult >= 5 ? '💥 SUPER WIN x' + chosenMult + '!' : chosenMult > 0 ? '✅ Menang x' + chosenMult : '😞 Tidak ada kombinasi';
    const bonanzaEmbed = new EmbedBuilder()
      .setTitle('🎰 BONANZA SLOT!' + (user.isVIP ? ' 👑 VIP' : ''))
      .setColor(chosenMult >= 50 ? C_GOLD : chosenMult > 0 ? C_GREEN : C_RED)
      .setDescription('**[ ' + gridDisplay + ' ]**\n\n**' + bonanzaTitleText + '**')
      .addFields(
        { name: '🎯 Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '🎲 Multiplier', value: chosenMult > 0 ? 'x' + chosenMult : 'Kalah', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: chosenMult > 0 ? '💵 Kemenangan Kotor' : '💸 Kerugian', value: chosenMult > 0 ? wonBonanza.toLocaleString('id-ID') + ' BFL' : bet.toLocaleString('id-ID') + ' BFL hangus', inline: true },
        { name: chosenMult > 0 ? '📈 Profit Bersih' : '📉 Total Rugi', value: chosenMult > 0 ? '+' + profitBonanza.toLocaleString('id-ID') + ' BFL' : bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '🏛️ Pajak', value: taxBonanza > 0 ? '-' + taxBonanza.toLocaleString('id-ID') + ' BFL (' + (user.isVIP ? '5%' : '20%') + ')' : 'Bebas pajak', inline: true },
        { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
      )
      .setFooter({ text: 'Min: 20.000 | Max: 1.000.000 BFL | WR: ' + Math.round(wrBonanzaBase) + '% menang (1.5x/2.5x/5x/50x)' });
    return message.reply({ embeds: [bonanzaEmbed] });
  }

  // ======================== !mancing ========================
  if (command === 'mancing') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 500;
    if (user.balance < cost) return message.reply('Saldo BFL tidak cukup! Biaya mancing: **500 BFL**');

    // #4: WR configurable via !setwr, admin 85%
    const wrMancing = (db.gameConfig && db.gameConfig.wrMancing != null) ? db.gameConfig.wrMancing : 0.50;
    const isWin = Math.random() < (message.author.id === ADMIN_ID ? 0.85 : (user.isVIP ? Math.min(wrMancing + 0.10, 0.95) : wrMancing));
    user.balance -= cost;
    sendToAdmin(db, cost);

    let fish;
    if (isWin) {
      fish = weightedRandom(FISH_TABLE.filter(f => f.price > 0));
    } else {
      fish = FISH_TABLE[0]; // Ikan Busuk
    }

    const inv = getInventory(db, message.author.id);
    inv.push({ type: 'ikan', name: fish.name, price: fish.price, time: new Date().toISOString() });

    // === LOOTBOX CHECK (30% chance dari mancing) ===
    const lootboxChanceMancing = Math.random();
    let lootboxMsgMancing = '';
    if (lootboxChanceMancing < 0.30) {
      const lootboxPrize = Math.floor(Math.random() * (550000 - 250000 + 1)) + 250000;
      user.balance += lootboxPrize;
      lootboxMsgMancing = '\n\n🎁 **LOOTBOX BERHADIAH!** Kamu mendapat kotak hadiah senilai **+' + lootboxPrize.toLocaleString('id-ID') + ' BFL**! 🎉';
    }

    consumeHunger(user, 'mancing');
    saveDB(db);

    const actionMsg2 = randomFrom(FISH_MESSAGES);
    const netMancing = fish.price - cost;
    const embedMancing = new EmbedBuilder()
      .setTitle('🎣 Hasil Memancing' + (user.isVIP ? ' 👑 VIP' : ''))
      .setColor(lootboxMsgMancing ? C_GOLD : (fish.price >= cost ? C_GOLD : C_BLUE))
      .setDescription('*' + actionMsg2 + '*' + lootboxMsgMancing)
      .addFields(
        { name: '🐟 Tangkapan', value: '**' + fish.name + '**', inline: true },
        { name: '💰 Nilai Ikan', value: fish.price > 0 ? fish.price.toLocaleString('id-ID') + ' BFL' : 'Tidak bernilai', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎣 Biaya Mancing', value: '-' + cost.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: netMancing >= 0 ? '📈 Keuntungan' : '📉 Kerugian', value: (netMancing >= 0 ? '+' : '') + netMancing.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '📦 Disimpan di', value: 'Inventori → Jual dengan `!jual ikan`', inline: false },
        { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
      )
      .setFooter({ text: 'WR: ' + Math.round(wrMancing * 100) + '% | Biaya: 500 BFL | 🎁 Lootbox: 30% chance (250k-550k BFL)' });
    return message.reply({ embeds: [embedMancing] });
  }

  // ======================== !mancingidr ========================
  if (command === 'mancingidr') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 500; // 500 IDR
    if ((user.balanceIDR || 0) < cost) return message.reply('Saldo IDR tidak cukup! Biaya mancing IDR: **Rp 500**');

    const isWin = Math.random() < (user.isVIP ? 0.45 : 0.35);
    user.balanceIDR -= cost;
    // Biaya mancing masuk admin
    const adminUserMI = getUserByDiscordId(db, ADMIN_ID);
    if (adminUserMI) { ensureUserFields(adminUserMI); adminUserMI.balanceIDR = (adminUserMI.balanceIDR || 0) + cost; }

    let fish;
    if (isWin) {
      fish = weightedRandomJitter(FISH_TABLE_IDR.filter(f => f.price > 0));
    } else {
      fish = FISH_TABLE_IDR[0];
    }

    user.balanceIDR += fish.price;
    consumeHunger(user, 'mancing');
    saveDB(db);

    const actionMsg = randomFrom(FISH_MESSAGES);
    const netMancingIDR = fish.price - cost;
    const embedMI = new EmbedBuilder()
      .setTitle('🎣 Hasil Memancing IDR' + (user.isVIP ? ' 👑 VIP' : ''))
      .setColor(fish.price > cost ? C_GOLD : C_RED)
      .setDescription('*' + actionMsg + '*')
      .addFields(
        { name: '🐟 Tangkapan', value: '**' + fish.name + '**', inline: true },
        { name: '💰 Nilai Ikan', value: fish.price > 0 ? 'Rp ' + fish.price.toLocaleString('id-ID') : 'Tidak bernilai', inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎣 Biaya Mancing', value: '-Rp ' + cost.toLocaleString('id-ID'), inline: true },
        { name: netMancingIDR >= 0 ? '📈 Keuntungan' : '📉 Kerugian', value: (netMancingIDR >= 0 ? '+Rp ' : '-Rp ') + Math.abs(netMancingIDR).toLocaleString('id-ID'), inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
      )
      .setFooter({ text: 'WR: ' + (user.isVIP ? '45%' : '35%') + ' | Biaya: Rp 500' });
    return message.reply({ embeds: [embedMI] });
  }

  // ======================== !tambang ========================
  if (command === 'tambang') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 200;
    if (user.balance < cost) return message.reply('Saldo tidak cukup! Biaya tambang: **200 BFL**');

    // #4: WR configurable via !setwr, admin 85%
    const wrTambang = (db.gameConfig && db.gameConfig.wrTambang != null) ? db.gameConfig.wrTambang : 0.50;
    const isWin = Math.random() < (message.author.id === ADMIN_ID ? 0.85 : (user.isVIP ? Math.min(wrTambang + 0.10, 0.95) : wrTambang));
    user.balance -= cost;
    sendToAdmin(db, cost);

    const actionMsg = randomFrom(MINE_MESSAGES);
    consumeHunger(user, 'tambang');

    let material;
    if (isWin) {
      material = weightedRandom(MINE_TABLE.filter(m => m.price > 0));
    } else {
      material = MINE_TABLE[0]; // Sampah
    }

    if (material.price < 0) {
      user.balance += material.price;
      if (user.balance < 0) user.balance = 0;
      saveDB(db);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('⛏️ Hasil Menambang' + (user.isVIP ? ' 👑 VIP' : ''))
          .setColor(C_RED)
          .setDescription('*' + actionMsg + '*')
          .addFields(
            { name: '🗑️ Temuan', value: '**Sampah** — tidak ada nilai', inline: true },
            { name: '💸 Biaya Tambang', value: '-' + cost.toLocaleString('id-ID') + ' BFL', inline: true },
            { name: '📉 Total Rugi', value: (cost + Math.abs(material.price)).toLocaleString('id-ID') + ' BFL', inline: true },
            { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
          )
          .setFooter({ text: 'Sial! Coba lagi... WR: ' + (user.isVIP ? '60%' : '50%') + ' | Biaya: 200 BFL' })
      ]});
    }

    const inv = getInventory(db, message.author.id);
    inv.push({ type: 'tambang', name: material.name, price: material.price, time: new Date().toISOString() });

    // === LOOTBOX CHECK (30% chance dari tambang) ===
    const lootboxChanceTambang = Math.random();
    let lootboxMsgTambang = '';
    if (lootboxChanceTambang < 0.30) {
      const lootboxPrizeTambang = Math.floor(Math.random() * (550000 - 250000 + 1)) + 250000;
      user.balance += lootboxPrizeTambang;
      lootboxMsgTambang = '\n\n🎁 **LOOTBOX BERHADIAH!** Kamu menemukan kotak tersembunyi senilai **+' + lootboxPrizeTambang.toLocaleString('id-ID') + ' BFL**! 🎉';
    }

    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('⛏️ Hasil Menambang' + (user.isVIP ? ' 👑 VIP' : ''))
        .setColor(lootboxMsgTambang ? C_GOLD : (material.price >= 10000 ? C_GOLD : material.price >= 1000 ? C_ORANGE : C_BLUE))
        .setDescription('*' + actionMsg + '*' + lootboxMsgTambang)
        .addFields(
          { name: '💎 Temuan', value: '**' + material.name + '**', inline: true },
          { name: '💰 Nilai Material', value: material.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '⛏️ Biaya Tambang', value: '-' + cost.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '📈 Keuntungan Bersih', value: '+' + (material.price - cost).toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '📦 Disimpan di', value: 'Inventori → Jual dengan `!jual tambang`', inline: false },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'WR: ' + Math.round(wrTambang * 100) + '% | Biaya: 200 BFL | 🎁 Lootbox: 30% chance (250k-550k BFL)' })
    ]});
  }

  // ======================== !tambangidr ========================
  if (command === 'tambangidr') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 200;
    if ((user.balanceIDR || 0) < cost) return message.reply('Saldo IDR tidak cukup! Biaya tambang IDR: **Rp 200**');

    const isWin = Math.random() < (user.isVIP ? 0.45 : 0.35);
    user.balanceIDR -= cost;
    // Biaya tambang IDR masuk admin
    const adminUserTI = getUserByDiscordId(db, ADMIN_ID);
    if (adminUserTI) { ensureUserFields(adminUserTI); adminUserTI.balanceIDR = (adminUserTI.balanceIDR || 0) + cost; }

    const actionMsg = randomFrom(MINE_MESSAGES);
    consumeHunger(user, 'tambang');

    let material;
    if (isWin) {
      material = weightedRandomJitter(MINE_TABLE_IDR.filter(m => m.price > 0));
    } else {
      material = MINE_TABLE_IDR[0];
    }

    user.balanceIDR += material.price;
    if (user.balanceIDR < 0) user.balanceIDR = 0;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('⛏️ Hasil Menambang IDR' + (user.isVIP ? ' 👑 VIP' : ''))
        .setColor(material.price > cost ? C_GOLD : C_RED)
        .setDescription('*' + actionMsg + '*')
        .addFields(
          { name: material.price > 0 ? '💎 Temuan' : '🗑️ Temuan', value: '**' + material.name + '**', inline: true },
          { name: '💰 Nilai Material', value: material.price > 0 ? 'Rp ' + material.price.toLocaleString('id-ID') : 'Tidak bernilai', inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '⛏️ Biaya Tambang', value: '-Rp ' + cost.toLocaleString('id-ID'), inline: true },
          { name: material.price >= cost ? '📈 Keuntungan' : '📉 Kerugian', value: (material.price >= cost ? '+Rp ' : '-Rp ') + Math.abs(material.price - cost).toLocaleString('id-ID'), inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'WR: ' + (user.isVIP ? '45%' : '35%') + ' | Biaya: Rp 200' })
    ]});
  }

  // ======================== !jual ========================
  if (command === 'jual') {
    if (!user) return message.reply('Belum terdaftar!');
    const type = args[0]?.toLowerCase();
    if (!type || !['ikan', 'tambang', 'monster'].includes(type)) return message.reply('Format: `!jual ikan`, `!jual tambang`, atau `!jual monster`');

    const inv    = getInventory(db, message.author.id);
    const toSell = inv.filter(i => i.type === type);
    if (toSell.length === 0) return message.reply('Inventori ' + type + ' kamu kosong!');

    const total = toSell.reduce((sum, i) => sum + i.price, 0);
    db.inventory[message.author.id] = inv.filter(i => i.type !== type);

    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (adminUser) { adminUser.balance -= total; if (adminUser.balance < 0) adminUser.balance = 0; }
    user.balance += total;
    const taxJual = applyTax(db, user, total);
    saveDB(db);

    const typeLabel = type === 'ikan' ? '🐟 Ikan' : type === 'monster' ? '👾 Monster' : '⛏️ Material Tambang';
    const embedJual = new EmbedBuilder()
      .setTitle('💰 Jual ' + typeLabel + ' Berhasil!')
      .setColor(C_GREEN)
      .addFields(
        { name: '📦 Item Terjual', value: toSell.length + ' item', inline: true },
        { name: '💵 Total Penjualan', value: total.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: taxJual > 0 ? '🏛️ Pajak (' + (user.isVIP ? '5%' : '20%') + ')' : '🏛️ Pajak', value: taxJual > 0 ? '-' + taxJual.toLocaleString('id-ID') + ' BFL' : 'Tidak dikenai pajak', inline: true },
        { name: '📋 Detail Item', value: toSell.map(i => '• ' + i.name + ' — ' + i.price.toLocaleString('id-ID') + ' BFL').join('\n').slice(0, 800) || '-' }
      )
      .setFooter({ text: 'Pajak dikenakan untuk keuntungan > 20.000 BFL' });
    return message.reply({ embeds: [embedJual] });
  }

  // ======================== !inventori ========================
  if (command === 'inventori' || command === 'inventory') {
    if (!user) return message.reply('Belum terdaftar!');
    const inv = getInventory(db, message.author.id);
    if (inv.length === 0) return message.reply('Inventori kamu kosong! Coba `!mancing`, `!tambang`, atau `!hunt`.');
    const ikan    = inv.filter(i => i.type === 'ikan');
    const tambang = inv.filter(i => i.type === 'tambang');
    const monster = inv.filter(i => i.type === 'monster');
    const embed = new EmbedBuilder()
      .setTitle('🎒 Inventori - ' + message.author.username)
      .setColor(C_BLUE)
      .addFields(
        { name: '🐟 Ikan (' + ikan.length + ')', value: (ikan.length ? ikan.map(i => i.name + ' (' + i.price + ' BFL)').join('\n').slice(0, 400) : 'Kosong') },
        { name: '⛏️ Material (' + tambang.length + ')', value: (tambang.length ? tambang.map(i => i.name + ' (' + i.price + ' BFL)').join('\n').slice(0, 400) : 'Kosong') },
        { name: '👾 Monster (' + monster.length + ')', value: (monster.length ? monster.map(i => i.name + ' (' + i.price + ' BFL)').join('\n').slice(0, 400) : 'Kosong') }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !give makan ========================
  if (command === 'give' && args[0]?.toLowerCase() === 'makan') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu sendiri kehabisan makan!');
    const target = message.mentions.users.first();
    if (!target) return message.reply('Format: `!give makan @user`');
    if (target.id === message.author.id) return message.reply('Tidak bisa memberi makan ke diri sendiri!');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    ensureUserFields(targetUser);
    const foodConfig = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum' };
    if (user.balance < foodConfig.price) return message.reply('Saldo tidak cukup! Harga: ' + foodConfig.price.toLocaleString('id-ID') + ' BFL');
    if (targetUser.hunger >= 100) return message.reply(target.username + ' sudah kenyang!');
    const nyawaTargetBefore = targetUser.hunger;
    user.balance -= foodConfig.price;
    targetUser.hunger = 100;
    sendToAdmin(db, foodConfig.price);
    saveDB(db);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🍱 Memberi Makan!')
        .setColor(C_GREEN)
        .setDescription('**' + message.author.username + '** dengan baik hati memberi makan kepada **' + target.username + '**!')
        .addFields(
          { name: '🎁 Pengirim', value: message.author.username, inline: true },
          { name: '📥 Penerima', value: target.username, inline: true },
          { name: '💰 Biaya', value: '-' + foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '❤️ Nyawa ' + target.username + ' Sebelum', value: hungerBar(nyawaTargetBefore), inline: false },
          { name: '❤️ Nyawa ' + target.username + ' Sekarang', value: hungerBar(100), inline: false }
        )
        .setFooter({ text: 'Berbagi itu indah! ❤️' })
    ]});
  }

  // ======================== !ayam (Gacha Ayam - 100.000 BFL) ========================
  if (command === 'ayam' || command === 'gacha' || command === 'gachaayam') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.balance < AYAM_GACHA_PRICE) return message.reply('Saldo tidak cukup! Harga Gacha Ayam: **' + AYAM_GACHA_PRICE.toLocaleString('id-ID') + ' BFL**');

    // Cari level yang tersedia (belum ada pemilik)
    const availableLevels = [];
    for (let lv = 1; lv <= 100; lv++) {
      const code = 'AYAM' + String(lv).padStart(3, '0');
      if (!db.ayamCodes[code]) availableLevels.push(lv);
    }

    if (availableLevels.length === 0) {
      return message.reply('❌ Semua ayam Lv.1-100 sudah dimiliki orang lain!\nCek toko ayam dengan `!tokoayam` untuk membeli dari pemain lain.');
    }

    // Random level dari yang tersedia (GACHA!)
    const level = availableLevels[Math.floor(Math.random() * availableLevels.length)];
    const code  = 'AYAM' + String(level).padStart(3, '0');

    user.balance -= AYAM_GACHA_PRICE;
    sendToAdmin(db, AYAM_GACHA_PRICE);
    db.ayamCodes[code] = message.author.id;

    const ayam = { code, level, name: 'Ayam Lv.' + level, beli: new Date().toISOString() };
    user.chickens.push(ayam);
    saveDB(db);

    let tierText = level >= 80 ? '🔥 LEGENDA!' : level >= 60 ? '💪 Kuat!' : level >= 40 ? '😊 Lumayan' : level >= 20 ? '😐 Biasa' : '😢 Lemah';
    let tierColor = level >= 80 ? C_GOLD : level >= 50 ? C_ORANGE : C_BLUE;
    const embedAyam = new EmbedBuilder()
      .setTitle('🎰 GACHA AYAM!')
      .setColor(tierColor)
      .setDescription('🎲 Kamu melakukan **GACHA AYAM**...\n\n🐓 Kamu mendapat **Ayam Lv.' + level + '** ' + tierText)
      .addFields(
        { name: '🐓 Nama Ayam', value: 'Ayam Lv.' + level, inline: true },
        { name: '⚡ Level', value: level + '/100', inline: true },
        { name: '🏷️ Tier', value: tierText, inline: true },
        { name: '🔑 Kode Unik', value: '`' + code + '`', inline: true },
        { name: '💰 Biaya Gacha', value: '-' + AYAM_GACHA_PRICE.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '🎰 Sisa Slot Gacha', value: (availableLevels.length - 1) + ' ayam tersisa', inline: true },
        { name: '📊 Kekuatan di Sabung', value: 'Level lebih tinggi = peluang menang lebih besar!\nMaks prob menang: **75%** (selisih level maks)', inline: false },
        { name: '⚔️ Cara Sabung', value: '`!sabung @user ' + code + ' <taruhan>`', inline: true },
        { name: '🏪 Cara Jual', value: '`!jualayam ' + code + ' <harga>`', inline: true },
        { name: '📦 Lihat Koleksi', value: '`!ayamku`', inline: true }
      )
      .setFooter({ text: 'Harga Gacha: ' + AYAM_GACHA_PRICE.toLocaleString('id-ID') + ' BFL | Total slot: 100 ayam' });
    return message.reply({ embeds: [embedAyam] });
  }

  // ======================== !ayamku ========================
  if (command === 'ayamku') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.chickens.length === 0) return message.reply('Kamu belum punya ayam! Gacha dengan `!ayam` (harga ' + AYAM_GACHA_PRICE.toLocaleString('id-ID') + ' BFL).');
    const list = user.chickens.map(a => '`' + a.code + '` **Lv.' + a.level + '** — ' + a.name).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('🐓 Ayam Milikmu - ' + message.author.username)
      .setColor(C_BROWN)
      .setDescription(list)
      .addFields(
        { name: 'Total Ayam', value: String(user.chickens.length) + ' ekor', inline: true },
        { name: 'Cara Sabung', value: '`!sabung @user <kode_ayam> <taruhan>`', inline: false },
        { name: 'Cara Jual di Toko', value: '`!jualayam <kode> <harga>`', inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== #5: !tokoayam ========================
  if (command === 'tokoayam') {
    if (!db.tokoAyam || db.tokoAyam.length === 0) return message.reply('🐓 Toko Ayam kosong! Tidak ada ayam yang dijual saat ini.\nJual ayammu dengan `!jualayam <kode> <harga>`');
    const list = db.tokoAyam.map((item, i) =>
      (i + 1) + '. `' + item.code + '` **Lv.' + item.level + '** — Rp ' + item.price.toLocaleString('id-ID') + ' BFL | Penjual: ' + item.sellerTag
    ).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('🐓 Toko Ayam')
      .setColor(C_BROWN)
      .setDescription(list.slice(0, 2000))
      .addFields({ name: 'Cara Beli', value: '`!beliayamtoko <kode>`' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== #5: !jualayam <kode> <harga> ========================
  if (command === 'jualayam') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    const kode  = args[0]?.toUpperCase();
    const harga = parseInt(args[1]);
    if (!kode || isNaN(harga) || harga <= 0) return message.reply('Format: `!jualayam <kode> <harga>`\nContoh: `!jualayam AYAM005 15000`');

    const ayamIdx = user.chickens.findIndex(a => a.code === kode);
    if (ayamIdx === -1) return message.reply('Ayam dengan kode `' + kode + '` tidak ada di koleksimu!');

    const ayam = user.chickens[ayamIdx];
    // Cek sudah di toko?
    if (db.tokoAyam.find(item => item.code === kode)) return message.reply('Ayam ini sudah ada di toko!');

    db.tokoAyam.push({
      code: kode,
      level: ayam.level,
      name: ayam.name,
      price: harga,
      sellerId: message.author.id,
      sellerTag: message.author.tag
    });
    user.chickens.splice(ayamIdx, 1);
    saveDB(db);

    return message.reply('✅ Ayam `' + kode + '` (Lv.' + ayam.level + ') berhasil dimasukkan ke toko dengan harga **' + harga.toLocaleString('id-ID') + ' BFL**!');
  }

  // ======================== #5: !beliayamtoko <kode> ========================
  if (command === 'beliayamtoko') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    const kode = args[0]?.toUpperCase();
    if (!kode) return message.reply('Format: `!beliayamtoko <kode>`\nLihat toko: `!tokoayam`');

    const itemIdx = db.tokoAyam.findIndex(item => item.code === kode);
    if (itemIdx === -1) return message.reply('Ayam `' + kode + '` tidak ada di toko!');

    const item = db.tokoAyam[itemIdx];
    if (item.sellerId === message.author.id) return message.reply('Tidak bisa membeli ayammu sendiri dari toko!');
    if (user.balance < item.price) return message.reply('Saldo tidak cukup! Harga: **' + item.price.toLocaleString('id-ID') + ' BFL**');

    const seller = getUserByDiscordId(db, item.sellerId);
    user.balance -= item.price;
    if (seller) seller.balance += item.price;

    // Transfer kode kepemilikan
    db.ayamCodes[kode] = message.author.id;
    user.chickens.push({ code: kode, level: item.level, name: item.name, beli: new Date().toISOString() });
    db.tokoAyam.splice(itemIdx, 1);
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🐓 Ayam Berhasil Dibeli dari Toko!')
        .setColor(C_BROWN)
        .setDescription('Kamu berhasil membeli **' + item.name + '** dari toko!')
        .addFields(
          { name: '🐓 Ayam', value: item.name, inline: true },
          { name: '⚡ Level', value: String(item.level) + '/100', inline: true },
          { name: '🔑 Kode', value: '`' + kode + '`', inline: true },
          { name: '💰 Harga Beli', value: '-' + item.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '🏪 Penjual', value: item.sellerTag, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '⚔️ Cara Sabung', value: '`!sabung @user ' + kode + ' <taruhan>`', inline: true },
          { name: '🏪 Cara Jual Lagi', value: '`!jualayam ' + kode + ' <harga>`', inline: true }
        )
        .setFooter({ text: 'Lihat koleksi ayammu: !ayamku' })
    ]});
  }

  // ======================== #5: !sabung (simplified) ========================
  if (command === 'sabung') {
    if (isDM) return message.reply('!sabung hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const target    = message.mentions.users.first();
    const myKode    = args[1]?.toUpperCase();
    const bet       = parseInt(args[2]);

    if (!target || !myKode || isNaN(bet) || bet <= 0) {
      return message.reply('Format: `!sabung @user <kode_ayammu> <taruhan>`\nContoh: `!sabung @Budi AYAM045 10000`\nLihat ayammu: `!ayamku`');
    }
    if (target.id === message.author.id) return message.reply('Tidak bisa sabung dengan diri sendiri!');
    if (target.bot) return message.reply('Tidak bisa sabung dengan bot!');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const myAyam = user.chickens.find(a => a.code === myKode);
    if (!myAyam) return message.reply('Ayam `' + myKode + '` tidak ada di koleksimu! Cek `!ayamku`');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    ensureUserFields(targetUser);
    if (targetUser.balance < bet) return message.reply(target.username + ' tidak punya saldo cukup!');

    if (targetUser.chickens.length === 0) return message.reply(target.username + ' tidak punya ayam!');

    if (db.sabungPending[target.id]) return message.reply(target.username + ' masih punya tantangan sabung yang belum dijawab!');

    db.sabungPending[target.id] = {
      challengerId: message.author.id,
      challengerTag: message.author.tag,
      myKode,
      myAyamLevel: myAyam.level,
      bet,
      channelId: message.channel.id,
      timestamp: Date.now()
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🐓 Tantangan Sabung Ayam!')
      .setColor(C_BROWN)
      .setDescription('<@' + target.id + '>! **' + message.author.username + '** menantangmu sabung ayam!\n\nGunakan ayam mana saja yang kamu miliki untuk melawan!\nLihat ayammu: `!ayamku`')
      .addFields(
        { name: '🐓 Ayam Penantang', value: '`' + myKode + '` Lv.' + myAyam.level, inline: true },
        { name: '💰 Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Cara Jawab', value: '`!accayam <kode_ayammu>` — Terima & pilih ayammu\n`!cancelayam` — Tolak' }
      )
      .setFooter({ text: 'Expired dalam 2 menit' });
    await message.reply({ embeds: [embed] });

    setTimeout(() => {
      const dbNow = loadDB();
      if (dbNow.sabungPending[target.id] && dbNow.sabungPending[target.id].challengerId === message.author.id) {
        delete dbNow.sabungPending[target.id];
        saveDB(dbNow);
        message.channel.send('<@' + target.id + '> Tantangan sabung expired!').catch(() => {});
      }
    }, 2 * 60 * 1000);
    return;
  }

  // ======================== !accayam ========================
  if (command === 'accayam') {
    if (isDM) return message.reply('!accayam hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    const pending = db.sabungPending[message.author.id];
    if (!pending) return message.reply('Kamu tidak punya tantangan sabung yang menunggu!');

    // User pilih ayam mereka sendiri
    const myKode = args[0]?.toUpperCase();
    if (!myKode) return message.reply('Format: `!accayam <kode_ayammu>`\nContoh: `!accayam AYAM012`\nLihat ayammu: `!ayamku`');

    const myAyam = user.chickens.find(a => a.code === myKode);
    if (!myAyam) return message.reply('Ayam `' + myKode + '` tidak ada di koleksimu!');

    const challenger = getUserByDiscordId(db, pending.challengerId);
    if (!challenger) {
      delete db.sabungPending[message.author.id];
      saveDB(db);
      return message.reply('Penantang tidak ditemukan!');
    }
    ensureUserFields(challenger);

    const challAyam = challenger.chickens.find(a => a.code === pending.myKode);
    if (!challAyam) {
      delete db.sabungPending[message.author.id];
      saveDB(db);
      return message.reply('Ayam penantang tidak ditemukan lagi. Dibatalkan.');
    }

    if (challenger.balance < pending.bet || user.balance < pending.bet) {
      delete db.sabungPending[message.author.id];
      saveDB(db);
      return message.reply('Saldo salah satu pihak tidak cukup. Dibatalkan.');
    }

    // Mekanisme: level menentukan probabilitas
    const lvA = challAyam.level;
    const lvB = myAyam.level;
    let winProbA = 0.5;
    if (lvA !== lvB) {
      const diff = Math.abs(lvA - lvB) / 100;
      const highWin = Math.min(0.75, 0.5 + diff * 0.3);
      winProbA = lvA > lvB ? highWin : 1 - highWin;
    }
    // Admin WR 85%
    if (pending.challengerId === ADMIN_ID) winProbA = 0.85;
    else if (message.author.id === ADMIN_ID) winProbA = 0.15;
    else {
      if (challenger.isVIP) winProbA = Math.min(0.95, winProbA + 0.20);
      if (user.isVIP) winProbA = Math.max(0.05, winProbA - 0.20);
    }

    const rand = Math.random();
    let resultText = '';
    let taxSabung = 0;

    if (rand < winProbA) {
      challenger.balance += pending.bet;
      user.balance -= pending.bet;
      taxSabung = applyTax(db, challenger, pending.bet);
      resultText = '🏆 **' + (challenger.discordTag || 'Penantang') + '** MENANG dengan **' + challAyam.name + '** (Lv.' + lvA + ')!';
    } else {
      user.balance += pending.bet;
      challenger.balance -= pending.bet;
      taxSabung = applyTax(db, user, pending.bet);
      resultText = '🏆 **' + message.author.username + '** MENANG dengan **' + myAyam.name + '** (Lv.' + lvB + ')!';
    }

    delete db.sabungPending[message.author.id];
    saveDB(db);

    const sabungWinner = rand < winProbA ? (challenger.discordTag || 'Penantang') : message.author.username;
    const sabungWinnerAyam = rand < winProbA ? challAyam : myAyam;
    const sabungLoserAyam  = rand < winProbA ? myAyam : challAyam;
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🐓 Sabung Ayam — Hasil Pertarungan!')
        .setColor(C_BROWN)
        .setDescription('⚔️ **Pertarungan sengit telah usai!**\n\n🏆 **' + sabungWinner + '** menang dengan **' + sabungWinnerAyam.name + '**!')
        .addFields(
          { name: '🐓 ' + challAyam.name + ' — ' + (challenger.discordTag || 'Penantang'), value: 'Level: **' + lvA + '**/100\nStatus: ' + (rand < winProbA ? '🏆 MENANG' : '💀 KALAH'), inline: true },
          { name: 'VS', value: '⚔️', inline: true },
          { name: '🐓 ' + myAyam.name + ' — ' + message.author.username, value: 'Level: **' + lvB + '**/100\nStatus: ' + (rand < winProbA ? '💀 KALAH' : '🏆 MENANG'), inline: true },
          { name: '💰 Taruhan', value: pending.bet.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '🏆 Pemenang Dapat', value: '+' + pending.bet.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '🏛️ Pajak', value: taxSabung > 0 ? '-' + taxSabung.toLocaleString('id-ID') + ' BFL (' + (user.isVIP || challenger.isVIP ? '5%' : '20%') + ')' : 'Bebas pajak', inline: true },
          { name: '📊 Probabilitas Menang', value: '🔵 ' + (challenger.discordTag || 'Penantang') + ': ' + Math.round(winProbA * 100) + '%\n🔴 ' + message.author.username + ': ' + Math.round((1 - winProbA) * 100) + '%', inline: false },
          { name: '❤️ Nyawa ' + message.author.username, value: hungerBar(user.hunger), inline: true },
          { name: '❤️ Nyawa ' + (challenger.discordTag || 'Penantang'), value: hungerBar(challenger.hunger), inline: true }
        )
        .setFooter({ text: 'Ayam level lebih tinggi punya peluang menang lebih besar!' })
    ]});
  }

  // ======================== !cancelayam ========================
  if (command === 'cancelayam') {
    if (isDM) return message.reply('!cancelayam hanya bisa di server!');
    const pending = db.sabungPending[message.author.id];
    if (!pending) return message.reply('Kamu tidak punya tantangan sabung yang menunggu!');
    delete db.sabungPending[message.author.id];
    saveDB(db);
    return message.reply('<@' + message.author.id + '> menolak tantangan sabung dari <@' + pending.challengerId + '>!');
  }

  // ======================== #8: !hunt (Berburu Monster) ========================
  if (command === 'hunt') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const HUNT_COST = 800;
    const HUNT_WR   = (db.gameConfig && db.gameConfig.wrHunt != null) ? db.gameConfig.wrHunt : 0.50; // configurable WR

    const MONSTER_TABLE = [
      { name: 'Tikus Raksasa',   emoji: '🐀', harga: 1000  },
      { name: 'Ular Berbisa',    emoji: '🐍', harga: 3000  },
      { name: 'Serigala Liar',   emoji: '🐺', harga: 5000  },
      { name: 'Babi Hutan Ganas',emoji: '🐗', harga: 8000  },
      { name: 'Beruang Monster', emoji: '🐻', harga: 12000 },
      { name: 'Naga Kecil',      emoji: '🐲', harga: 16000 },
      { name: 'Titan Rimba',     emoji: '👹', harga: 20000 },
    ];

    if (user.balance < HUNT_COST) return message.reply('❌ Saldo tidak cukup! Biaya berburu: **' + HUNT_COST.toLocaleString('id-ID') + ' BFL**');

    user.balance -= HUNT_COST;
    sendToAdmin(db, HUNT_COST);

    const berhasil = Math.random() < HUNT_WR;

    if (!berhasil) {
      consumeHunger(user, 'default');
      saveDB(db);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🏹 Berburu Gagal!')
          .setColor(C_RED)
          .setDescription('Kamu pergi berburu tapi tidak berhasil menangkap monster apapun...\nMonster kabur ke dalam hutan!')
          .addFields(
            { name: '💸 Biaya Berburu', value: '-' + HUNT_COST.toLocaleString('id-ID') + ' BFL', inline: true },
            { name: '🎯 Win Rate', value: '50%', inline: true },
            { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
          )
          .setFooter({ text: 'Jangan menyerah! Coba berburu lagi dengan !hunt' })
      ]});
    }

    // Berhasil — ambil monster acak dari tabel berbobot sederhana
    const monster = MONSTER_TABLE[Math.floor(Math.random() * MONSTER_TABLE.length)];

    // Simpan ke inventori sebagai item jual
    const inv = getInventory(db, message.author.id);
    inv.push({ type: 'monster', name: monster.name + ' ' + monster.emoji, price: monster.harga, time: new Date().toISOString() });

    // === LOOTBOX CHECK (30% chance dari hunt) ===
    const lootboxChanceHunt = Math.random();
    let lootboxMsgHunt = '';
    if (lootboxChanceHunt < 0.30) {
      const lootboxPrizeHunt = Math.floor(Math.random() * (550000 - 250000 + 1)) + 250000;
      user.balance += lootboxPrizeHunt;
      lootboxMsgHunt = '\n\n🎁 **LOOTBOX BERHADIAH!** Monster menjatuhkan kotak hadiah senilai **+' + lootboxPrizeHunt.toLocaleString('id-ID') + ' BFL**! 🎉';
    }

    consumeHunger(user, 'default');
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🏹 Berburu Berhasil! ' + monster.emoji)
        .setColor(lootboxMsgHunt ? C_GOLD : C_GREEN)
        .setDescription('Kamu berhasil memburu **' + monster.name + '** ' + monster.emoji + '!' + lootboxMsgHunt)
        .addFields(
          { name: '👾 Monster', value: monster.emoji + ' **' + monster.name + '**', inline: true },
          { name: '💰 Nilai Jual', value: monster.harga.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '💸 Biaya Berburu', value: '-' + HUNT_COST.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '📈 Profit Bersih', value: '+' + (monster.harga - HUNT_COST).toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '📦 Tersimpan di', value: 'Inventori → Jual dengan `!jual monster`', inline: false },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'Biaya berburu: 800 BFL | WR: ' + Math.round(HUNT_WR * 100) + '% | 🎁 Lootbox: 30% chance (250k-550k BFL)' })
    ]});
  }
  // !party casino — buka sesi
  if (command === 'party' && args[0]?.toLowerCase() === 'casino') {
    if (isDM) return message.reply('!party casino hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');

    if (db.partyCasino) {
      const pc = db.partyCasino;
      const list = pc.players.map((p, i) => (i + 1) + '. <@' + p.id + '>').join('\n');
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🎮 Party Casino Sedang Berlangsung!')
          .setColor(C_TEAL)
          .setDescription('Sudah ada sesi casino aktif di channel ini!\n\nPemain yang bergabung:\n' + list)
          .addFields(
            { name: 'Host', value: '<@' + pc.hostId + '>', inline: true },
            { name: 'Slot', value: pc.players.length + '/5', inline: true },
            { name: 'Gabung', value: '`!join casino`', inline: false },
            { name: 'Main', value: '`!main casino <taruhan>`', inline: false }
          )
      ]});
    }

    db.partyCasino = {
      hostId: message.author.id,
      channelId: message.channel.id,
      players: [{ id: message.author.id, tag: message.author.tag }],
      createdAt: Date.now()
    };
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🎮 Party Casino Dibuka!')
        .setColor(C_TEAL)
        .setDescription('**' + message.author.username + '** membuka sesi Party Casino!\n\nMaksimal **5 orang** bisa bergabung.')
        .addFields(
          { name: 'Cara Gabung', value: '`!join casino`' },
          { name: 'Cara Main', value: '`!main casino <taruhan>` setelah semua siap' },
          { name: 'Pemain (1/5)', value: '1. <@' + message.author.id + '>' }
        )
    ]});
  }

  // !join casino
  if (command === 'join' && args[0]?.toLowerCase() === 'casino') {
    if (isDM) return message.reply('!join casino hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');

    if (!db.partyCasino) return message.reply('Tidak ada sesi casino aktif! Buat dengan `!party casino`');
    if (db.partyCasino.players.find(p => p.id === message.author.id)) return message.reply('Kamu sudah bergabung!');
    if (db.partyCasino.players.length >= 5) return message.reply('Party casino sudah penuh (5/5)!');

    db.partyCasino.players.push({ id: message.author.id, tag: message.author.tag });
    saveDB(db);

    const list = db.partyCasino.players.map((p, i) => (i + 1) + '. <@' + p.id + '>').join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🎮 Bergabung ke Party Casino!')
        .setColor(C_TEAL)
        .setDescription('**' + message.author.username + '** bergabung!')
        .addFields(
          { name: 'Pemain (' + db.partyCasino.players.length + '/5)', value: list },
          { name: 'Main', value: '`!main casino <taruhan>`' }
        )
    ]});
  }

  // !main casino <taruhan>  — hanya HOST yang bisa tentukan bet
  if (command === 'main' && args[0]?.toLowerCase() === 'casino') {
    if (isDM) return message.reply('!main casino hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');

    if (!db.partyCasino) return message.reply('Tidak ada sesi casino aktif!');

    // Hanya host yang bisa menentukan taruhan
    if (message.author.id !== db.partyCasino.hostId) {
      return message.reply('❌ Hanya **host** party casino yang bisa menentukan taruhan!\nHost: <@' + db.partyCasino.hostId + '>');
    }

    if (!db.partyCasino.players.find(p => p.id === message.author.id)) return message.reply('Kamu belum bergabung!');
    if (db.partyCasino.players.length < 2) return message.reply('❌ Minimal 2 pemain untuk main casino!');

    const bet = parseInt(args[1]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!main casino <taruhan>`');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan!');

    // ---- POKER HAND EVALUATOR ----
    const SUITS = ['♠️', '♥️', '♦️', '♣️'];
    const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const RANK_VAL = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

    function dealPokerHand(deckRef) {
      const hand = [];
      for (let i = 0; i < 5; i++) {
        const idx = Math.floor(Math.random() * deckRef.length);
        hand.push(deckRef.splice(idx, 1)[0]);
      }
      return hand;
    }

    function evaluateHand(hand) {
      const vals = hand.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
      const suits = hand.map(c => c.suit);
      const counts = {};
      vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      const freq = Object.values(counts).sort((a, b) => b - a);
      const isFlush = suits.every(s => s === suits[0]);
      const isStraight = (new Set(vals).size === 5) && (vals[0] - vals[4] === 4);
      const topVal = vals[0];
      const pairVal = parseInt(Object.entries(counts).find(([,c]) => c === 2)?.[0] || 0);
      const tripleVal = parseInt(Object.entries(counts).find(([,c]) => c === 3)?.[0] || 0);

      if (isFlush && isStraight && vals[0] === 14) return { rank: 9, label: '👑 Royal Flush',        score: 9000 + topVal };
      if (isFlush && isStraight)                   return { rank: 8, label: '🔥 Straight Flush',     score: 8000 + topVal };
      if (freq[0] === 4)                            return { rank: 7, label: '💥 Four of a Kind',     score: 7000 + topVal };
      if (freq[0] === 3 && freq[1] === 2)          return { rank: 6, label: '🏠 Full House',          score: 6000 + tripleVal };
      if (isFlush)                                  return { rank: 5, label: '🌊 Flush',              score: 5000 + topVal };
      if (isStraight)                               return { rank: 4, label: '📈 Straight',           score: 4000 + topVal };
      if (freq[0] === 3)                            return { rank: 3, label: '🎯 Three of a Kind',    score: 3000 + tripleVal };
      if (freq[0] === 2 && freq[1] === 2)          return { rank: 2, label: '👥 Two Pair',            score: 2000 + pairVal };
      if (freq[0] === 2)                            return { rank: 1, label: '🃏 One Pair',            score: 1000 + pairVal };
      return                                               { rank: 0, label: '🂠 High Card',           score: topVal };
    }

    function handDisplay(hand) {
      return hand.map(c => '`' + c.rank + c.suit + '`').join(' ');
    }

    // Buat deck bersama
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });

    // Kumpulkan saldo & bagikan kartu
    let pool = 0;
    const participated = [];
    const skipped = [];

    for (const player of db.partyCasino.players) {
      const pUser = getUserByDiscordId(db, player.id);
      if (!pUser) { skipped.push(player); continue; }
      ensureUserFields(pUser);
      if (isStarving(pUser) || pUser.balance < bet) { skipped.push(player); continue; }
      pUser.balance -= bet;
      pool += bet;
      sendToAdmin(db, bet);
      consumeHunger(pUser, 'slot');
      const hand = dealPokerHand(deck);
      const result = evaluateHand(hand);
      participated.push({ player, pUser, hand, result });
    }

    if (participated.length === 0) {
      saveDB(db);
      return message.reply('❌ Tidak ada pemain yang bisa ikut (saldo tidak cukup / lapar)!');
    }

    // Tentukan pemenang berdasarkan skor hand tertinggi
    participated.sort((a, b) => b.result.score - a.result.score);
    const winnerEntry = participated[0];
    winnerEntry.pUser.balance += pool;
    const adminCasino = getUserByDiscordId(db, ADMIN_ID);
    if (adminCasino) { adminCasino.balance = Math.max(0, adminCasino.balance - pool); }

    let taxCasino = 0;
    const casProfit = pool - bet;
    if (casProfit > 0) taxCasino = applyTax(db, winnerEntry.pUser, casProfit);

    saveDB(db);

    // Buat tampilan kartu setiap pemain
    const playerLines = participated.map((e, i) => {
      const isWinner = i === 0;
      const prefix = isWinner ? '🏆' : '❌';
      return prefix + ' <@' + e.player.id + '>\n   Kartu: ' + handDisplay(e.hand) + '\n   Hand: **' + e.result.label + '**' + (isWinner ? ' ← **MENANG!**' : '');
    }).join('\n\n');
    const skippedLines = skipped.length > 0 ? '\n⏭️ Dilewati: ' + skipped.map(p => '<@' + p.id + '>').join(', ') : '';

    const embed = new EmbedBuilder()
      .setTitle('🃏 Party Casino POKER - Selesai!')
      .setColor(C_GOLD)
      .setDescription('**Total Pool:** ' + pool.toLocaleString('id-ID') + ' BFL\n\n' + playerLines + skippedLines + '\n\n🎉 Pemenang: <@' + winnerEntry.player.id + '> membawa **' + pool.toLocaleString('id-ID') + ' BFL**!')
      .addFields(
        { name: 'Aturan Poker', value: 'Royal Flush > Straight Flush > Four of a Kind > Full House > Flush > Straight > Three of a Kind > Two Pair > One Pair > High Card' },
        { name: 'Sesi Baru', value: '`!party casino` untuk mulai lagi' }
      );
    db.partyCasino = null;
    saveDB(db);
    return message.reply({ embeds: [embed] });
  }

  // ======================== !kupon (claim kupon custom, bisa semua orang) ========================
  if (command === 'kupon') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    const now = Date.now();

    // Cek apakah ada kupon aktif yang dibuat admin
    if (!db.activeCoupon) {
      return message.reply('❌ Tidak ada kupon aktif saat ini. Tunggu admin membuat kupon baru dengan `!buatkupon`.');
    }

    const coupon = db.activeCoupon;

    // Cek apakah kupon masih valid (25 menit)
    const COUPON_WINDOW = 25 * 60 * 1000; // 25 menit
    if (now - coupon.createdAt > COUPON_WINDOW) {
      db.activeCoupon = null;
      saveDB(db);
      return message.reply('❌ Kupon sudah kedaluwarsa! Kupon hanya valid selama **25 menit**.');
    }

    // Cek apakah user sudah klaim kupon ini
    if (!coupon.claimed) coupon.claimed = [];
    if (coupon.claimed.includes(message.author.id)) {
      return message.reply('❌ Kamu sudah mengklaim kupon ini!');
    }

    // Gacha hadiah: 70% item, 30% uang
    const roll = Math.random();
    let rewardDesc = '';

    if (roll < 0.30) {
      // 30% uang 50.000 - 150.000
      const uang = Math.floor(Math.random() * 100001) + 50000;
      user.balance += uang;
      rewardDesc = '💰 **Uang ' + uang.toLocaleString('id-ID') + ' BFL**';
    } else {
      // 70% item (ikan + material tambang)
      const inv = getInventory(db, message.author.id);
      const ikanRewards = [];
      for (let i = 0; i < 3; i++) {
        const ikan = weightedRandom(FISH_TABLE.filter(f => f.price > 0));
        inv.push({ type: 'ikan', name: ikan.name, price: ikan.price, time: new Date().toISOString() });
        ikanRewards.push(ikan.name);
      }
      const tambangRewards = [];
      for (let i = 0; i < 3; i++) {
        const mat = weightedRandom(MINE_TABLE.filter(m => m.price > 0));
        inv.push({ type: 'tambang', name: mat.name, price: mat.price, time: new Date().toISOString() });
        tambangRewards.push(mat.name);
      }
      user.hunger = Math.min(100, user.hunger + 30);
      rewardDesc = '📦 **Paket Item:**\n🐟 Ikan: ' + ikanRewards.join(', ') + '\n⛏️ Material: ' + tambangRewards.join(', ');
    }

    // Tandai user sudah klaim
    coupon.claimed.push(message.author.id);
    saveDB(db);

    // Hitung sisa waktu
    const sisaMs = COUPON_WINDOW - (now - coupon.createdAt);
    const sisaM = Math.floor(sisaMs / 60000);
    const sisaS = Math.floor((sisaMs % 60000) / 1000);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🎟️ Kupon Berhasil Diklaim!')
        .setColor(C_PURPLE)
        .setDescription('Kamu berhasil mengklaim kupon dari admin!')
        .addFields(
          { name: '🎁 Hadiah', value: rewardDesc },
          { name: '⏰ Kupon Berakhir', value: 'Dalam ' + sisaM + ' menit ' + sisaS + ' detik', inline: true },
          { name: '🎲 Peluang Hadiah', value: '30% Uang (50k-150k) | 70% Item', inline: true },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'Kupon hanya bisa diklaim 1x per orang per sesi!' })
    ]});
  }

  // ======================== !buatkupon (ADMIN only) ========================
  if (command === 'buatkupon') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Hanya admin yang bisa membuat kupon!');

    const now = Date.now();

    // Jika ada kupon aktif yang belum expired, hapus dulu
    if (db.activeCoupon) {
      const elapsed = now - db.activeCoupon.createdAt;
      if (elapsed < 25 * 60 * 1000) {
        return message.reply('❌ Masih ada kupon aktif! Tunggu sampai expired (25 menit) atau gunakan `!hapuskupon` untuk menghapusnya.');
      }
    }

    // Buat kupon baru
    db.activeCoupon = {
      createdAt: now,
      createdBy: message.author.id,
      claimed: [],
    };
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🎟️ Kupon Dibuat!')
        .setColor(C_GOLD)
        .setDescription('Kupon baru berhasil dibuat! Semua orang bisa mengklaimnya dengan `!kupon`.')
        .addFields(
          { name: '⏰ Berlaku', value: '**25 menit** sejak sekarang', inline: true },
          { name: '🎲 Hadiah', value: '30% Uang (50k-150k BFL) | 70% Item', inline: true },
          { name: '📢 Info', value: 'Setiap user hanya bisa klaim **1x** per sesi kupon!' }
        )
        .setFooter({ text: 'Kupon akan otomatis expired setelah 25 menit.' })
    ]});
  }

  // ======================== !hapuskupon (ADMIN only) ========================
  if (command === 'hapuskupon') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Hanya admin!');
    if (!db.activeCoupon) return message.reply('Tidak ada kupon aktif!');
    db.activeCoupon = null;
    saveDB(db);
    return message.reply('✅ Kupon aktif berhasil dihapus!');
  }

  // ======================== !cashback (Klaim cashback kekalahan 30%) ========================
  if (command === 'cashback') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    const today = new Date().toISOString().slice(0, 10);
    if (user.dailyLossDate !== today) {
      return message.reply('❌ Belum ada kekalahan hari ini yang bisa di-cashback!');
    }
    if (user.dailyLoss <= 0) {
      return message.reply('❌ Tidak ada kekalahan hari ini!');
    }
    if (user.cashbackClaimed) {
      return message.reply('❌ Cashback hari ini sudah diklaim!\nCoba lagi besok setelah kalah main.');
    }

    const cashbackAmount = Math.floor(user.dailyLoss * 0.10);
    user.balance += cashbackAmount;
    user.cashbackClaimed = true;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('💸 Cashback Kekalahan Harian!')
        .setColor(C_GREEN)
        .setDescription('Cashback **10%** dari total kekalahan hari ini berhasil diklaim!')
        .addFields(
          { name: '📉 Total Kekalahan Hari Ini', value: user.dailyLoss.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '💸 Persentase Cashback', value: '10%', inline: true },
          { name: '💰 Cashback Diterima', value: '+' + cashbackAmount.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '📋 Catatan', value: 'Cashback hanya bisa diklaim **1x per hari**.\nReset otomatis setiap tengah malam.', inline: false },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'Cashback berlaku untuk kekalahan slot, dadu, bonanza, dll.' })
    ]});
  }

  // ======================== #2: !kerja (Gaji 60.000, timer 10 menit) ========================
  if (command === 'kerja') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.isDead) return message.reply('💀 Kamu sedang **MATI**! Tunggu EMS menyembuhkanmu dulu.\n`!ems @kamu` (biaya 100.000 BFL)');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    // Cek penjara
    if (user.jailUntil && Date.now() < user.jailUntil) {
      const sisa = user.jailUntil - Date.now();
      const m = Math.floor(sisa / 60000);
      return message.reply('🔒 Kamu di **PENJARA**! Tidak bisa kerja. Sisa: **' + m + ' menit**');
    }

    const jobKey = message.author.id;
    const activeJob = db.jobs[jobKey];
    if (activeJob) {
      const elapsed = Date.now() - activeJob.startTime;
      const totalDuration = activeJob.tasks.reduce((s, t) => s + t.duration, 0);
      const remaining = totalDuration - elapsed;
      if (remaining > 0) {
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        return message.reply('🚧 Kamu sedang **' + activeJob.name + '**!\nSisa waktu: **' + m + ' menit ' + s + ' detik**');
      }
    }

    const subJob = args[0]?.toLowerCase();
    const fraksiUser = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const isGoodside = fraksiUser && fraksiUser.side === 'good';

    const jobList = 'Pilih pekerjaan:\n⛏️ **Kuli** — Gaji **60.000 BFL** | Timer 10 menit\n`!kerja kuli`\n\n🍕 **Antar Pizza** — Gaji **60.000 BFL** | Timer 10 menit\n`!kerja pizza`' +
      (isGoodside ? '\n\n_(Fraksi Goodside: gunakan `!gajiharian` untuk klaim gaji harian 80.000 BFL)_' : '');

    if (!subJob) return message.reply(jobList);

    let jobData = null;

    if (subJob === 'kuli') {
      jobData = {
        name: 'Kuli Bangunan',
        emoji: '⛏️',
        gaji: 60000,
        tasks: [
          { name: 'Menyelesaikan Pekerjaan Kuli', duration: 10 * 60 * 1000 }
        ]
      };
    } else if (subJob === 'pizza') {
      jobData = {
        name: 'Antar Pizza',
        emoji: '🍕',
        gaji: 60000,
        tasks: [
          { name: 'Mengantar Semua Pesanan Pizza', duration: 10 * 60 * 1000 }
        ]
      };
    } else {
      return message.reply('Pekerjaan tidak dikenal!\n' + jobList);
    }

    jobData.startTime = Date.now();
    jobData.userId = message.author.id;
    db.jobs[jobKey] = jobData;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(jobData.emoji + ' Mulai Kerja: ' + jobData.name)
        .setColor(C_BLUE)
        .setDescription('Kamu mulai bekerja sebagai **' + jobData.name + '**! Selesaikan tugasmu.')
        .addFields(
          { name: '💼 Pekerjaan', value: jobData.emoji + ' ' + jobData.name, inline: true },
          { name: '💰 Gaji', value: jobData.gaji.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '⏱️ Durasi', value: '10 menit', inline: true },
          { name: '🏛️ Pajak Gaji', value: 'Gaji tidak dipotong pajak', inline: true },
          { name: '🚫 Larangan', value: 'Tidak bisa mancing, tambang, slot, dadu saat bekerja!', inline: false },
          { name: '⚠️ Cara Ambil Gaji', value: 'Ketik `!ambilgaji` setelah 10 menit selesai.\nCek progress: `!cekkerja`', inline: false },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'Semangat bekerja! 💪' })
    ]});
  }

  // ======================== !cekkerja ========================
  if (command === 'cekkerja') {
    if (!user) return message.reply('Belum terdaftar!');
    const activeJob = db.jobs[message.author.id];
    if (!activeJob) return message.reply('Kamu sedang tidak bekerja. Mulai dengan `!kerja`');
    const elapsed = Date.now() - activeJob.startTime;
    const totalDuration = activeJob.tasks.reduce((s, t) => s + t.duration, 0);
    const remaining = totalDuration - elapsed;
    if (remaining <= 0) return message.reply('✅ Kerja selesai! Ketik `!ambilgaji` untuk ambil **' + activeJob.gaji.toLocaleString('id-ID') + ' BFL**!');
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(activeJob.emoji + ' Status Kerja')
        .setColor(C_ORANGE)
        .addFields(
          { name: 'Pekerjaan', value: activeJob.name, inline: true },
          { name: '⏱️ Sisa Waktu', value: m + ' menit ' + s + ' detik', inline: true },
          { name: '💰 Gaji', value: activeJob.gaji.toLocaleString('id-ID') + ' BFL', inline: true }
        )
    ]});
  }

  // ======================== !ambilgaji ========================
  if (command === 'ambilgaji') {
    if (!user) return message.reply('Belum terdaftar!');
    const activeJob = db.jobs[message.author.id];
    if (!activeJob) return message.reply('Kamu sedang tidak bekerja!');
    const elapsed = Date.now() - activeJob.startTime;
    const totalDuration = activeJob.tasks.reduce((s, t) => s + t.duration, 0);
    if (elapsed < totalDuration) {
      const remaining = totalDuration - elapsed;
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      return message.reply('⏳ Kerja belum selesai! Tunggu **' + m + ' menit ' + s + ' detik** lagi.');
    }
    user.balance += activeJob.gaji;
    consumeHunger(user, 'default');
    delete db.jobs[message.author.id];
    saveDB(db);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('💰 Gaji Diterima! ' + activeJob.emoji)
        .setColor(C_GREEN)
        .setDescription('Kerja keras terbayar! Gaji **' + activeJob.name + '** sudah masuk ke kantong kamu.')
        .addFields(
          { name: '💼 Pekerjaan', value: activeJob.emoji + ' ' + activeJob.name, inline: true },
          { name: '💵 Gaji Diterima', value: '+' + activeJob.gaji.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '⏱️ Durasi Kerja', value: '10 menit', inline: true },
          { name: '🏛️ Pajak', value: 'Gaji tidak dikenai pajak', inline: true },
          { name: '📋 Info', value: 'Kamu bisa kerja lagi sekarang!\nGunakan `!kerja` untuk shift berikutnya.', inline: false },
          { name: '❤️ Sisa Nyawa', value: hungerBar(user.hunger), inline: false }
        )
        .setFooter({ text: 'Perintah: !kerja kuli | !kerja pizza' })
    ]});
  }

  // ========= BLOKIR AKTIVITAS SAAT KERJA =========
  const BLOCKED_DURING_JOB = ['mancing', 'tambang', 'mancingidr', 'tambangidr', 'slot', 'slotidr', 'bonanza', 'dadu', 'daduidr', 'acc', 'rain', 'sabung', 'accayam', 'tip'];
  if (BLOCKED_DURING_JOB.includes(command)) {
    const activeJob = db.jobs[message.author.id];
    if (activeJob) {
      const elapsed = Date.now() - activeJob.startTime;
      const totalDuration = activeJob.tasks.reduce((s, t) => s + t.duration, 0);
      if (elapsed < totalDuration) {
        const remaining = totalDuration - elapsed;
        const m = Math.floor(remaining / 60000);
        return message.reply('🚧 Kamu sedang bekerja sebagai **' + activeJob.name + '**!\nTidak bisa beraktivitas lain. Sisa: **' + m + ' menit**\nCek: `!cekkerja`');
      }
    }
  }

  // ========= BLOKIR AKTIVITAS SAAT DI PENJARA =========
  // Di penjara: tidak bisa slot, bonanza, dadu, casino, war
  const BLOCKED_IN_JAIL = ['slot', 'slotidr', 'bonanza', 'dadu', 'daduidr', 'main', 'joincasino', 'party', 'war', 'senjata'];
  if (user && BLOCKED_IN_JAIL.includes(command)) {
    ensureUserFields(user);
    if (user.jailUntil && Date.now() < user.jailUntil) {
      const sisa = user.jailUntil - Date.now();
      const m = Math.floor(sisa / 60000);
      const s = Math.floor((sisa % 60000) / 1000);
      return message.reply('🔒 Kamu sedang di **PENJARA**! Sisa hukuman: **' + m + ' menit ' + s + ' detik**\nKamu hanya bisa `!mancing`, `!tambang`, dan bekerja.');
    }
  }

  // ======================== ADMIN COMMANDS ========================

  if (command === 'adminhelp') {
    if (message.author.id !== ADMIN_ID) return;
    const embed = new EmbedBuilder()
      .setTitle('👑 Admin Command List - BFL Coin')
      .setColor(C_PURPLE)
      .addFields(
        { name: '📋 USER MANAGEMENT', value:
          '`!register @user` — Daftarkan user\n' +
          '`!givecoin @user <jumlah>` — Beri BFL ke user\n' +
          '`!minuscoin @user <jumlah>` — Kurangi BFL user\n' +
          '`!giveidr @user <jumlah>` — Beri IDR ke user\n' +
          '`!allusers` — Semua user (sorted saldo tertinggi)\n' +
          '`!top` — Leaderboard\n' +
          '`!addbalance <jumlah>` — Tambah saldo BFL admin\n' +
          '`!addbalanceidr <jumlah>` — Tambah saldo IDR admin'
        },
        { name: '⚔️ ROLEPLAY', value:
          '`!berisenjata @user <senjata>` — Beri senjata ke Polisi/Tentara\n' +
          '`!resetwar` — Reset semua war yang stuck\n' +
          '`!resetwar @user` — Reset war flag user tertentu\n' +
          '`!setfraksi @user <fraksi>` — Assign fraksi langsung\n' +
          '`!accfraksi <id>` / `!tolakfraksi <id>` — Approve/tolak\n' +
          '`!emsforce @user` — Sembuhkan paksa gratis\n' +
          '`!bebasin @user` — Bebaskan dari penjara'
        },
        { name: '⚙️ WIN RATE CONFIG (DM Only)', value:
          '`!setwr <jenis> <persen>` — Set WR aktivitas\n' +
          'Jenis: `jualdrug` `mancing` `tambang` `slot` `hunt` `bonanza`\n' +
          'Contoh: `!setwr slot 60` → WR slot jadi 60%\n' +
          '`!cekwr` — Lihat semua WR saat ini'
        },
        { name: '💳 TOPUP & TARIK IDR', value:
          '`!topupok <discordId> <jumlah>` — Approve topup IDR\n' +
          '`!approve <discordId> <jumlah>` — Approve tarik IDR\n' +
          '`!reject <discordId>` — Tolak tarik & kembalikan IDR'
        },
        { name: '🍱 MAKAN CONFIG', value:
          '`!setmakan <harga> <nama> <deskripsi>`\n' +
          '`!cekfood`'
        },
        { name: '🎮 CASINO', value:
          '`!closecasino` — Tutup sesi party casino aktif'
        },
        { name: '📢 LAINNYA', value:
          '`!setwelcome <pesan>`\n' +
          '`!cekwelcome`\n' +
          '`!admincheck`'
        }
      );
    return message.reply({ embeds: [embed] });
  }

  // !closecasino (host atau admin)
  if (command === 'closecasino') {
    if (!db.partyCasino) return message.reply('Tidak ada sesi casino aktif!');
    const isHost = db.partyCasino.hostId === message.author.id;
    const isAdm  = message.author.id === ADMIN_ID;
    if (!isHost && !isAdm) return message.reply('❌ Hanya **host** party atau **admin** yang bisa menutup casino!');
    db.partyCasino = null;
    saveDB(db);
    return message.reply('✅ Sesi Party Casino ditutup.');
  }

  if (command === 'setwelcome') {
    if (message.author.id !== ADMIN_ID) return;
    const msg = args.join(' ');
    if (!msg) return message.reply('Format: `!setwelcome <pesan>`');
    db.customWelcomeMsg = msg;
    saveDB(db);
    return message.reply('✅ Pesan welcome diperbarui: ' + msg);
  }

  if (command === 'cekwelcome') {
    if (message.author.id !== ADMIN_ID) return;
    return message.reply('Pesan welcome: ' + (db.customWelcomeMsg || '*(default)*'));
  }

  if (command === 'top') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Hanya admin!');
    const sorted = Object.values(db.users).sort((a, b) => b.balance - a.balance).slice(0, 10);
    const list = sorted.map((u, i) => (i + 1) + '. ' + (u.discordTag || u.noHp) + ' — ' + u.balance.toLocaleString('id-ID') + ' BFL').join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('Leaderboard BFL Coin')
        .setColor(C_GOLD)
        .setDescription(list || 'Belum ada data.')
    ]});
  }

  // ======================== !topup (#8: hanya IDR) ========================
  if (command === 'topup') {
    if (!isDM) return message.reply('Topup hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < MIN_TOPUP) return message.reply('Minimal topup Rp' + MIN_TOPUP.toLocaleString('id-ID') + '\nFormat: `!topup <jumlah>`');
    db.pendingTopup[message.author.id] = { amount, timestamp: new Date().toISOString() };
    saveDB(db);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('Request Topup IDR')
        .setColor(C_BLUE)
        .setDescription('Transfer Rp' + amount.toLocaleString('id-ID') + ' ke DANA berikut:')
        .addFields(
          { name: 'No DANA Admin', value: DANA_ADMIN, inline: true },
          { name: 'Jumlah', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
          { name: 'Keterangan', value: 'TOPUP-' + message.author.id.slice(-4) },
          { name: 'Langkah', value: '1. Transfer ke DANA admin\n2. Screenshot bukti\n3. Kirim ke admin Discord\n4. Tunggu konfirmasi' }
        )
        .setFooter({ text: 'Saldo IDR akan ditambah setelah dikonfirmasi admin' })
    ]});
  }

  // ======================== !tarik (#8: hanya IDR) ========================
  if (command === 'tarik') {
    if (!isDM) return message.reply('Tarik hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    const amount = parseInt(args[0]);
    const noHp   = args[1];
    if (isNaN(amount) || amount < MIN_TARIK) return message.reply('❌ Minimal tarik Rp' + MIN_TARIK.toLocaleString('id-ID') + '\nFormat: `!tarik <jumlah> <no_dana>`');
    if (!noHp || !/^0[0-9]{9,12}$/.test(noHp)) return message.reply('❌ Nomor DANA tidak valid!\nFormat: `!tarik <jumlah> <no_dana>`');
    if ((user.balanceIDR || 0) < amount) return message.reply('Saldo IDR tidak cukup! Saldo IDR: Rp ' + (user.balanceIDR || 0).toLocaleString('id-ID'));

    const dupUser = Object.values(db.users).find(u => u.noHp === noHp && u.discordId !== message.author.id);
    if (dupUser) return message.reply('❌ Nomor DANA ini sudah terdaftar di akun lain!');

    user.noHp = noHp;
    user.balanceIDR -= amount;
    db.pendingTarik[message.author.id] = { amount, noHp, timestamp: new Date().toISOString() };
    saveDB(db);

    try {
      const adminUser = await client.users.fetch(ADMIN_ID);
      await adminUser.send({ embeds: [
        new EmbedBuilder()
          .setTitle('NOTIF: REQUEST TARIK IDR BARU')
          .setColor(C_ORANGE)
          .addFields(
            { name: 'User', value: message.author.tag + ' (' + message.author.id + ')' },
            { name: 'No DANA', value: noHp, inline: true },
            { name: 'Jumlah', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
            { name: 'Approve', value: '`!approve ' + message.author.id + ' ' + amount + '`' },
            { name: 'Tolak', value: '`!reject ' + message.author.id + '`' }
          )
      ]});
    } catch (e) {}

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('Request Tarik IDR Terkirim ✅')
        .setColor(C_BLUE)
        .setDescription('Request tarik IDR kamu sudah terkirim ke admin.')
        .addFields({ name: 'Estimasi', value: 'Maksimal 1x24 jam' })
    ]});
  }

  // ======================== !topupok (admin - menambah IDR) ========================
  if (command === 'topupok') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!topupok <discordId> <jumlah>`');
    const targetUser = getUserByDiscordId(db, targetId);
    if (!targetUser) return message.reply('User tidak ditemukan!');
    ensureUserFields(targetUser);
    targetUser.balanceIDR = (targetUser.balanceIDR || 0) + amount;
    delete db.pendingTopup[targetId];
    saveDB(db);
    try {
      const u = await client.users.fetch(targetId);
      await u.send({ embeds: [
        new EmbedBuilder()
          .setTitle('Topup IDR Berhasil!')
          .setColor(C_GREEN)
          .setDescription('Topup IDR berhasil masuk ke akunmu!')
      ]});
    } catch (e) {}
    return message.reply('Topup IDR Rp' + amount.toLocaleString('id-ID') + ' untuk <@' + targetId + '> berhasil!');
  }

  // ======================== !approve (admin) ========================
  if (command === 'approve') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!approve <discordId> <jumlah>`');
    delete db.pendingTarik[targetId];
    saveDB(db);
    try {
      const u = await client.users.fetch(targetId);
      await u.send({ embeds: [
        new EmbedBuilder()
          .setTitle('Tarik IDR Diproses!')
          .setColor(C_GREEN)
          .setDescription('Penarikan Rp' + amount.toLocaleString('id-ID') + ' sedang dikirim ke DANA kamu!')
      ]});
    } catch (e) {}
    return message.reply('Tarik IDR Rp' + amount.toLocaleString('id-ID') + ' untuk <@' + targetId + '> disetujui!');
  }

  // ======================== !reject (admin) ========================
  if (command === 'reject') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const pending  = db.pendingTarik[targetId];
    if (!pending) return message.reply('Tidak ada request tarik dari user ini.');
    const targetUser = getUserByDiscordId(db, targetId);
    if (targetUser) {
      ensureUserFields(targetUser);
      targetUser.balanceIDR = (targetUser.balanceIDR || 0) + pending.amount;
    }
    delete db.pendingTarik[targetId];
    saveDB(db);
    try {
      const u = await client.users.fetch(targetId);
      await u.send('Request tarik IDR Rp' + pending.amount.toLocaleString('id-ID') + ' ditolak. Saldo IDR dikembalikan.');
    } catch (e) {}
    return message.reply('Request dari <@' + targetId + '> ditolak, saldo IDR dikembalikan.');
  }

  // ======================== !givecoin (admin) ========================
  if (command === 'givecoin') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('Format: `!givecoin @user <jumlah>`');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('User belum terdaftar!');
    targetUser.balance += amount;
    saveDB(db);
    return message.reply('✅ Berhasil memberi BFL ke ' + target.username + '!');
  }

  // ======================== !minuscoin (admin) ========================
  if (command === 'minuscoin') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('Format: `!minuscoin @user <jumlah>`');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('User belum terdaftar!');
    targetUser.balance = Math.max(0, targetUser.balance - amount);
    saveDB(db);
    try {
      await (await client.users.fetch(target.id)).send({ embeds: [
        new EmbedBuilder()
          .setTitle('⚠️ Saldo BFL Dikurangi Admin')
          .setColor(C_RED)
          .setDescription('Admin telah mengurangi BFL dari saldo kamu.')
      ]});
    } catch (e) {}
    return message.reply('✅ Saldo BFL ' + target.username + ' berhasil dikurangi.');
  }

  // ======================== !giveidr (admin) ========================
  if (command === 'giveidr') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('Format: `!giveidr @user <jumlah>`');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('User belum terdaftar!');
    ensureUserFields(targetUser);
    targetUser.balanceIDR = (targetUser.balanceIDR || 0) + amount;
    saveDB(db);
    return message.reply('Berhasil memberi Rp' + amount.toLocaleString('id-ID') + ' IDR ke ' + target.username + '!');
  }

  // ======================== !allusers (admin) ========================
  if (command === 'allusers') {
    if (message.author.id !== ADMIN_ID) return;
    const allUsers = Object.values(db.users)
      .sort((a, b) => (b.balance || 0) - (a.balance || 0));
    const totalPemain = allUsers.length;
    const list = allUsers
      .map((u, i) => (i + 1) + '. ' + (u.discordTag || u.noHp || 'Unknown') + ' — **' + (u.balance || 0).toLocaleString('id-ID') + ' BFL** | IDR: ' + (u.balanceIDR || 0).toLocaleString('id-ID'))
      .join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('👥 Semua User BFL Coin — Sorted by Saldo')
        .setColor(C_BLUE)
        .setDescription((list || 'Belum ada user.').slice(0, 4000))
        .setFooter({ text: 'Total Pemain: ' + totalPemain + ' orang | Diurutkan dari saldo tertinggi' })
    ]});
  }

  // ======================== !addbalance (admin) ========================
  if (command === 'addbalance') {
    if (message.author.id !== ADMIN_ID) return;
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('Format: `!addbalance <jumlah>`');
    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (!adminUser) return message.reply('Akun admin tidak ditemukan!');
    adminUser.balance += amount;
    saveDB(db);
    return message.reply('✅ Saldo admin bertambah ' + amount.toLocaleString('id-ID') + ' BFL. Total: ' + adminUser.balance.toLocaleString('id-ID') + ' BFL');
  }

  // ======================== !addbalanceidr (admin) ========================
  if (command === 'addbalanceidr') {
    if (message.author.id !== ADMIN_ID) return;
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('Format: `!addbalanceidr <jumlah>`');
    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (!adminUser) return message.reply('Akun admin tidak ditemukan!');
    ensureUserFields(adminUser);
    adminUser.balanceIDR = (adminUser.balanceIDR || 0) + amount;
    saveDB(db);
    return message.reply('✅ Saldo IDR admin bertambah Rp' + amount.toLocaleString('id-ID') + '. Total IDR: Rp' + adminUser.balanceIDR.toLocaleString('id-ID'));
  }

  // ======================== !setwr (admin — custom WR via DM) ========================
  // Format: !setwr <jenis> <persen>
  // Contoh: !setwr jualdrug 80  (artinya 80%)
  // Jenis: jualdrug, mancing, tambang, slot, hunt, bonanza
  if (command === 'setwr') {
    if (message.author.id !== ADMIN_ID) return;
    if (!isDM) return message.reply('⚠️ Command `!setwr` hanya bisa digunakan di **DM bot**!');

    const jenis = args[0]?.toLowerCase();
    const persen = parseFloat(args[1]);

    const validJenis = {
      jualdrug: 'wrJualdrug',
      mancing:  'wrMancing',
      tambang:  'wrTambang',
      slot:     'wrSlot',
      hunt:     'wrHunt',
      bonanza:  'wrBonanza',
    };

    if (!jenis || !validJenis[jenis]) {
      return message.reply(
        '❌ Jenis WR tidak valid!\n\n' +
        '**Format:** `!setwr <jenis> <persen>`\n' +
        '**Jenis tersedia:**\n' +
        '• `jualdrug` — WR jual narkoba\n' +
        '• `mancing` — WR memancing\n' +
        '• `tambang` — WR menambang\n' +
        '• `slot` — WR slot machine\n' +
        '• `hunt` — WR berburu monster\n' +
        '• `bonanza` — WR bonanza slot\n\n' +
        '**Contoh:** `!setwr jualdrug 80` → WR jual drug jadi 80%\n' +
        'Gunakan `!cekwr` untuk melihat WR saat ini.'
      );
    }

    if (isNaN(persen) || persen < 1 || persen > 99) {
      return message.reply('❌ Persen harus antara **1 - 99**!\nContoh: `!setwr slot 60`');
    }

    if (!db.gameConfig) db.gameConfig = {};
    const wrKey = validJenis[jenis];
    const wrLama = db.gameConfig[wrKey] != null ? Math.round(db.gameConfig[wrKey] * 100) : 50;
    db.gameConfig[wrKey] = persen / 100;

    // Sync DRUG_SELL_WR tidak bisa langsung (konstanta), tapi kita pakai gameConfig di jualdrug
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Win Rate Diperbarui!')
        .setColor(C_GREEN)
        .addFields(
          { name: '🎯 Jenis', value: '**' + jenis.toUpperCase() + '**', inline: true },
          { name: '📉 WR Lama', value: wrLama + '%', inline: true },
          { name: '📈 WR Baru', value: persen + '%', inline: true },
          { name: '💡 Info', value: 'Perubahan berlaku langsung!\nVIP mendapat bonus +10% dari WR yang diset.\nGunakan `!cekwr` untuk cek semua WR.', inline: false }
        )
    ]});
  }

  // ======================== !cekwr (admin — lihat semua WR saat ini) ========================
  if (command === 'cekwr') {
    if (message.author.id !== ADMIN_ID) return;
    if (!isDM) return message.reply('⚠️ Command `!cekwr` hanya bisa di **DM bot**!');
    const gc = db.gameConfig || {};
    const wrJualdrug = gc.wrJualdrug != null ? Math.round(gc.wrJualdrug * 100) : 75;
    const wrMancing  = gc.wrMancing  != null ? Math.round(gc.wrMancing  * 100) : 50;
    const wrTambang  = gc.wrTambang  != null ? Math.round(gc.wrTambang  * 100) : 50;
    const wrSlot     = gc.wrSlot     != null ? Math.round(gc.wrSlot     * 100) : 50;
    const wrHunt     = gc.wrHunt     != null ? Math.round(gc.wrHunt     * 100) : 50;
    const wrBonanza  = gc.wrBonanza  != null ? Math.round(gc.wrBonanza  * 100) : 50;
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('⚙️ Win Rate Config Saat Ini')
        .setColor(C_PURPLE)
        .setDescription('Semua WR bisa diubah via `!setwr <jenis> <persen>`\nVIP selalu dapat bonus **+10%** dari WR yang diset.')
        .addFields(
          { name: '🌿 Jualdrug',  value: wrJualdrug + '%', inline: true },
          { name: '🎣 Mancing',   value: wrMancing  + '%', inline: true },
          { name: '⛏️ Tambang',   value: wrTambang  + '%', inline: true },
          { name: '🎰 Slot',      value: wrSlot     + '%', inline: true },
          { name: '🏹 Hunt',      value: wrHunt     + '%', inline: true },
          { name: '🎰 Bonanza',   value: wrBonanza  + '%', inline: true },
          { name: '📋 Cara Ubah', value: '`!setwr jualdrug 80` → WR jual drug jadi 80%\n`!setwr slot 55` → WR slot jadi 55%', inline: false }
        )
        .setFooter({ text: 'Admin WR selalu 85% untuk semua aktivitas' })
    ]});
  }

  // ======================== !setmakan (admin) ========================
  if (command === 'setmakan') {
    if (message.author.id !== ADMIN_ID) return;
    if (!isDM) return message.reply('⚠️ Command !setmakan hanya di DM admin!');
    const price = parseInt(args[0]);
    if (isNaN(price) || price <= 0) return message.reply('Format: `!setmakan <harga> <nama> <deskripsi>`');
    const nama = args[1] || 'Makan & Minum';
    const desc = args.slice(2).join(' ') || 'Bekal untuk beraktivitas';
    db.foodConfig = { price, name: nama, description: desc };
    saveDB(db);
    return message.reply('✅ Makan diperbarui: ' + nama + ' | Harga: ' + price.toLocaleString('id-ID') + ' BFL');
  }

  // ======================== !cekfood (admin) ========================
  if (command === 'cekfood') {
    if (message.author.id !== ADMIN_ID) return;
    const fc = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: '-' };
    return message.reply('🍱 ' + fc.name + ' | Harga: ' + fc.price.toLocaleString('id-ID') + ' BFL | ' + (fc.description || '-'));
  }

  // ======================== !admincheck ========================
  if (command === 'admincheck') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Kamu BUKAN admin. ID: `' + message.author.id + '`');
    return message.reply('✅ Kamu adalah ADMIN! ID: `' + message.author.id + '`');
  }

  // ============================================================
  // SISTEM NARKOBA — WEED & METH
  // ============================================================

  // ======================== !tokodrug ========================
  // Lihat toko bibit narkoba
  if (command === 'tokodrug' || command === 'tokonarkoba') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    const fUser = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const boleh = fUser && fUser.side === 'bad' || message.author.id === ADMIN_ID;
    if (!boleh) return message.reply('❌ Toko bibit hanya bisa diakses oleh fraksi **Badside**!');

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🌿 Toko Bibit Narkoba — Black Market')
        .setColor(0x228B22)
        .setDescription('Beli bibit, tanam 10 menit, jual hasilnya!\n⚠️ Jual narkoba punya risiko ditangkap Polisi/Tentara!')
        .addFields(
          { name: '🌿 Weed (Bibit)', value: 'Harga bibit: **50.000 BFL/pcs**\nHarga jual: **100.000 BFL/pcs**\nWaktu tumbuh: 10 menit\n`!belibibit weed <jumlah>`', inline: true },
          { name: '💎 Meth (Bibit)', value: 'Harga bibit: **35.000 BFL/pcs**\nHarga jual: **75.000 BFL/pcs**\nWaktu tumbuh: 10 menit\n`!belibibit meth <jumlah>`', inline: true },
          { name: '⚠️ Risiko', value: 'WR jual: **' + Math.round(((db.gameConfig && db.gameConfig.wrJualdrug != null) ? db.gameConfig.wrJualdrug : DRUG_SELL_WR) * 100) + '%** berhasil\nGagal = barang disita Admin!\nPolisi/Tentara bisa menangkap dengan `!pengejaran @kamu`', inline: false }
        )
    ]});
  }

  // ======================== !belibibit ========================
  // Beli bibit weed/meth
  if (command === 'belibibit') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    const fUser = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const boleh = (fUser && fUser.side === 'bad') || message.author.id === ADMIN_ID;
    if (!boleh) return message.reply('❌ Hanya fraksi **Badside** yang bisa beli bibit narkoba!\n_(Goodside dan Netral tidak diperbolehkan memperdagangkan narkoba)_');

    if (user.jailUntil && Date.now() < user.jailUntil) return message.reply('🔒 Kamu di penjara! Tidak bisa beli bibit.');

    const jenis = args[0]?.toLowerCase();
    const jumlah = parseInt(args[1]) || 1;
    if (!jenis || !DRUG_LIST[jenis]) return message.reply('❌ Format: `!belibibit weed <jumlah>` atau `!belibibit meth <jumlah>`');
    if (jumlah < 1 || jumlah > 50) return message.reply('❌ Jumlah harus antara 1-50.');

    const drug = DRUG_LIST[jenis];
    const total = drug.hargaBibit * jumlah;
    if (user.balance < total) return message.reply('❌ Saldo tidak cukup! Butuh **' + total.toLocaleString('id-ID') + ' BFL** untuk ' + jumlah + ' bibit ' + drug.name + '.');

    user.balance -= total;
    sendToAdmin(db, total);

    // Tambah ke tanaman
    if (!db.drugPlants[message.author.id]) db.drugPlants[message.author.id] = [];
    const plant = { jenis, jumlah, tanamAt: Date.now(), siapAt: Date.now() + drug.tumbuhMs };
    db.drugPlants[message.author.id].push(plant);
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(drug.emoji + ' Bibit Ditanam!')
        .setColor(0x228B22)
        .setDescription('**' + jumlah + ' bibit ' + drug.name + '** berhasil dibeli dan ditanam!')
        .addFields(
          { name: '💰 Biaya', value: '-' + total.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '⏱️ Siap panen', value: '10 menit', inline: true },
          { name: '💡 Cek', value: '`!cektanaman` untuk lihat status\n`!panen` saat sudah siap', inline: false }
        )
    ]});
  }

  // ======================== !cektanaman ========================
  if (command === 'cektanaman') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    const plants = db.drugPlants[message.author.id] || [];
    if (!plants.length) return message.reply('🌱 Kamu tidak punya tanaman. Beli bibit dengan `!belibibit weed/meth <jumlah>`');

    const now = Date.now();
    const lines = plants.map((p, i) => {
      const drug = DRUG_LIST[p.jenis];
      const siap = now >= p.siapAt;
      const sisa = Math.max(0, p.siapAt - now);
      const m = Math.floor(sisa / 60000), s = Math.floor((sisa % 60000) / 1000);
      return (i + 1) + '. ' + drug.emoji + ' **' + p.jumlah + 'x ' + drug.name + '** — ' + (siap ? '✅ SIAP PANEN!' : '⏳ Sisa ' + m + 'm ' + s + 'd');
    }).join('\n');

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🌿 Status Tanamanmu')
        .setColor(0x228B22)
        .setDescription(lines)
        .setFooter({ text: 'Gunakan !panen untuk memanen yang sudah siap' })
    ]});
  }

  // ======================== !panen ========================
  if (command === 'panen') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    const plants = db.drugPlants[message.author.id] || [];
    const now = Date.now();
    const siap = plants.filter(p => now >= p.siapAt);
    const belum = plants.filter(p => now < p.siapAt);

    if (!siap.length) return message.reply('⏳ Belum ada tanaman yang siap panen! Gunakan `!cektanaman` untuk cek status.');

    // Tambah ke inventory user
    for (const p of siap) {
      user.drugInv[p.jenis] = (user.drugInv[p.jenis] || 0) + p.jumlah;
    }
    db.drugPlants[message.author.id] = belum; // sisakan yg belum
    saveDB(db);

    const summary = siap.map(p => DRUG_LIST[p.jenis].emoji + ' ' + p.jumlah + 'x ' + DRUG_LIST[p.jenis].name).join(', ');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🌾 Panen Berhasil!')
        .setColor(C_GREEN)
        .setDescription('Kamu memanen: **' + summary + '**')
        .addFields(
          { name: '📦 Inventory', value: '🌿 Weed: ' + (user.drugInv.weed || 0) + ' pcs\n💎 Meth: ' + (user.drugInv.meth || 0) + ' pcs', inline: true },
          { name: '💡 Jual', value: '`!jualdrug weed <jumlah>` atau `!jualdrug meth <jumlah>`', inline: false }
        )
    ]});
  }

  // ======================== !jualdrug ========================
  if (command === 'jualdrug') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    if (user.jailUntil && Date.now() < user.jailUntil) return message.reply('🔒 Kamu di **PENJARA**! Tidak bisa jual narkoba.');

    const jenis = args[0]?.toLowerCase();
    const jumlah = parseInt(args[1]) || 1;
    if (!jenis || !DRUG_LIST[jenis]) return message.reply('❌ Format: `!jualdrug weed <jumlah>` atau `!jualdrug meth <jumlah>`');

    const drug = DRUG_LIST[jenis];
    if (!user.drugInv[jenis] || user.drugInv[jenis] < jumlah) {
      return message.reply('❌ Kamu hanya punya **' + (user.drugInv[jenis] || 0) + ' pcs ' + drug.name + '**! Kurang dari ' + jumlah + '.');
    }

    // Roll WR — pakai gameConfig jika ada, fallback ke 75%
    const wrJualDrug = (db.gameConfig && db.gameConfig.wrJualdrug != null) ? db.gameConfig.wrJualdrug : DRUG_SELL_WR;
    const berhasil = Math.random() < wrJualDrug;

    if (berhasil) {
      const pendapatan = drug.hargaJual * jumlah;
      user.drugInv[jenis] -= jumlah;
      user.balance += pendapatan;
      saveDB(db);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('✅ Jualan Berhasil! ' + drug.emoji)
          .setColor(C_GREEN)
          .setDescription('Kamu berhasil menjual **' + jumlah + 'x ' + drug.name + '**!')
          .addFields(
            { name: '💰 Pendapatan', value: '+' + pendapatan.toLocaleString('id-ID') + ' BFL', inline: true },
            { name: '📦 Sisa ' + drug.name, value: (user.drugInv[jenis] || 0) + ' pcs', inline: true },
            { name: '⚠️ Waspada', value: 'Polisi/Tentara bisa mengejarmu kapan saja!', inline: false }
          )
      ]});
    } else {
      // Gagal — barang disita + langsung masuk penjara 5 menit
      const disita = jumlah;
      user.drugInv[jenis] -= disita;
      if (!db.adminDrugInv) db.adminDrugInv = { weed: 0, meth: 0 };
      db.adminDrugInv[jenis] = (db.adminDrugInv[jenis] || 0) + disita;
      user.jailUntil = Date.now() + JAIL_DURATION_DRUG;
      saveDB(db);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🚔 TERTANGKAP! Barang Disita & Masuk Penjara! ' + drug.emoji)
          .setColor(C_RED)
          .setDescription('Operasi jual **' + jumlah + 'x ' + drug.name + '** GAGAL! Kamu ketahuan dan langsung ditangkap!')
          .addFields(
            { name: '📦 Disita', value: disita + 'x ' + drug.name + ' masuk ke inventory Admin', inline: true },
            { name: '🔒 Hukuman', value: '**Penjara 5 menit!**\nTidak bisa: slot, dadu, bonanza, casino, war, jual drug', inline: true },
            { name: '💡 Info', value: 'Gunakan `!statuspenjara` untuk cek sisa waktu', inline: false }
          )
      ]});
    }
  }

  // ======================== !druginv ========================
  if (command === 'druginv') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    const plants = (db.drugPlants[message.author.id] || []).length;
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('📦 Inventory Narkoba')
        .setColor(0x228B22)
        .addFields(
          { name: '🌿 Weed', value: (user.drugInv.weed || 0) + ' pcs', inline: true },
          { name: '💎 Meth', value: (user.drugInv.meth || 0) + ' pcs', inline: true },
          { name: '🌱 Tanaman aktif', value: plants + ' batch', inline: true }
        )
    ]});
  }

  // ======================== !admindruginv (admin) ========================
  if (command === 'admindruginv') {
    if (message.author.id !== ADMIN_ID) return;
    if (!db.adminDrugInv) db.adminDrugInv = { weed: 0, meth: 0 };
    return message.reply('📦 Inventory Admin (hasil sitaan):\n🌿 Weed: **' + db.adminDrugInv.weed + ' pcs**\n💎 Meth: **' + db.adminDrugInv.meth + ' pcs**');
  }

  // ======================== !pengejaran ========================
  // Polisi/Tentara mengejar penjual narkoba
  if (command === 'pengejaran') {
    if (isDM) return message.reply('❌ Command ini hanya bisa di server!');
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    // Cek apakah user adalah polisi, tentara, atau admin
    const isLawEnforcement = user.fraksi === 'polisi' || user.fraksi === 'tentara' || message.author.id === ADMIN_ID;
    if (!isLawEnforcement) return message.reply('❌ Hanya fraksi **Polisi** dan **Tentara** yang bisa melakukan pengejaran!');

    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Format: `!pengejaran @user`\nCara menangkap penjual narkoba!');
    if (target.id === message.author.id) return message.reply('❌ Tidak bisa mengejar diri sendiri!');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ User tidak ditemukan!');
    ensureUserFields(targetUser);

    // Cek apakah target punya narkoba
    const punya = (targetUser.drugInv.weed || 0) + (targetUser.drugInv.meth || 0) > 0;
    if (!punya) return message.reply('❌ ' + target.username + ' tidak punya narkoba. Tidak ada alasan untuk menangkap!');

    // Cek sudah di penjara
    if (targetUser.jailUntil && Date.now() < targetUser.jailUntil) {
      return message.reply('🔒 ' + target.username + ' sudah di penjara!');
    }

    // WR 50:50
    const berhasil = Math.random() < 0.5;

    if (berhasil) {
      // Tangkap! Semua narkoba disita, masuk penjara 10 menit
      const sitaWeed = targetUser.drugInv.weed || 0;
      const sitaMeth = targetUser.drugInv.meth || 0;
      targetUser.drugInv.weed = 0;
      targetUser.drugInv.meth = 0;
      if (!db.adminDrugInv) db.adminDrugInv = { weed: 0, meth: 0 };
      db.adminDrugInv.weed += sitaWeed;
      db.adminDrugInv.meth += sitaMeth;
      targetUser.jailUntil = Date.now() + JAIL_DURATION;
      saveDB(db);

      try {
        await (await client.users.fetch(target.id)).send({ embeds: [
          new EmbedBuilder()
            .setTitle('🚔 KAMU DITANGKAP!')
            .setColor(C_RED)
            .setDescription('Kamu ditangkap oleh **' + message.author.username + '** (Fraksi: ' + (user.fraksi ? FRAKSI_LIST[user.fraksi].label : 'Admin') + ')!')
            .addFields(
              { name: '📦 Narkoba Disita', value: '🌿 Weed: ' + sitaWeed + ' pcs\n💎 Meth: ' + sitaMeth + ' pcs', inline: true },
              { name: '🔒 Hukuman', value: '**Penjara 10 menit**\nTidak bisa: slot, dadu, bonanza, casino, war', inline: true }
            )
        ]});
      } catch(e) {}

      return message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle('🚔 PENGEJARAN BERHASIL!')
          .setColor(C_GREEN)
          .setDescription('<@' + message.author.id + '> berhasil menangkap <@' + target.id + '>!')
          .addFields(
            { name: '📦 Disita', value: '🌿 ' + sitaWeed + ' Weed | 💎 ' + sitaMeth + ' Meth', inline: true },
            { name: '🔒 Hukuman', value: 'Penjara **10 menit**', inline: true }
          )
      ]});
    } else {
      // Gagal tangkap — target kabur
      saveDB(db);
      return message.channel.send({ embeds: [
        new EmbedBuilder()
          .setTitle('💨 Pengejaran GAGAL!')
          .setColor(C_ORANGE)
          .setDescription('<@' + target.id + '> **berhasil kabur** dari pengejaran <@' + message.author.id + '>!')
          .setFooter({ text: 'WR pengejaran 50:50 — coba lagi!' })
      ]});
    }
  }

  // ======================== !statuspenjara ========================
  if (command === 'statuspenjara' || command === 'cekpenjara') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    if (!user.jailUntil || Date.now() >= user.jailUntil) return message.reply('✅ Kamu tidak sedang di penjara!');
    const sisa = user.jailUntil - Date.now();
    const m = Math.floor(sisa / 60000), s = Math.floor((sisa % 60000) / 1000);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🔒 Status Penjara')
        .setColor(C_RED)
        .setDescription('Kamu sedang **DI PENJARA**!')
        .addFields(
          { name: '⏱️ Sisa Waktu', value: m + ' menit ' + s + ' detik', inline: true },
          { name: '✅ Yang Bisa', value: '`!mancing`, `!tambang`, `!kerja`', inline: true },
          { name: '❌ Dilarang', value: 'Slot, dadu, bonanza, casino, war', inline: true }
        )
    ]});
  }

  // ======================== !bebasin (admin) ========================
  if (command === 'bebasin') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply('Format: `!bebasin @user`');
    const tUser = getUserByDiscordId(db, target.id);
    if (!tUser) return message.reply('User tidak ditemukan!');
    ensureUserFields(tUser);
    tUser.jailUntil = null;
    saveDB(db);
    try { await (await client.users.fetch(target.id)).send('✅ Admin telah membebaskanmu dari penjara!'); } catch(e) {}
    return message.reply('✅ ' + target.username + ' dibebaskan dari penjara!');
  }

  // ======================== !gajiharian ========================
  // Goodside klaim gaji harian 80.000 BFL
  if (command === 'gajiharian') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    const fUser = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const isGoodOrAdmin = (fUser && fUser.side === 'good') || message.author.id === ADMIN_ID;
    if (!isGoodOrAdmin) return message.reply('❌ Gaji harian hanya untuk fraksi **Goodside** (EMS, Pemerintah, Polisi, Tentara, dll)!\nFraksimu: ' + (fUser ? fUser.label : 'Belum bergabung'));

    const now = Date.now();
    if (user.lastGoodGaji && (now - user.lastGoodGaji) < GOODSIDE_DAILY_COOLDOWN) {
      const sisa = GOODSIDE_DAILY_COOLDOWN - (now - user.lastGoodGaji);
      const jam = Math.floor(sisa / 3600000);
      const menit = Math.floor((sisa % 3600000) / 60000);
      return message.reply('⏳ Gaji harian sudah diklaim! Klaim lagi dalam **' + jam + ' jam ' + menit + ' menit**.');
    }

    user.balance += GOODSIDE_DAILY_GAJI;
    user.lastGoodGaji = now;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('💼 Gaji Harian Diterima! ' + (fUser ? fUser.emoji : '⚖️'))
        .setColor(C_GREEN)
        .setDescription('Kamu menerima gaji harian sebagai anggota **' + (fUser ? fUser.label : 'Goodside') + '**!')
        .addFields(
          { name: '💰 Gaji', value: '+' + GOODSIDE_DAILY_GAJI.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '⏱️ Cooldown', value: '24 jam', inline: true }
        )
    ]});
  }

  // ============================================================
  // SISTEM ROLEPLAY COMMANDS
  // ============================================================

  // ======================== !fraksi ========================
  // Melihat semua fraksi yang tersedia
  if (command === 'fraksi') {
    const badside = Object.entries(FRAKSI_LIST).filter(([,f]) => f.side === 'bad');
    const goodside = Object.entries(FRAKSI_LIST).filter(([,f]) => f.side === 'good');
    const neutral = Object.entries(FRAKSI_LIST).filter(([,f]) => f.side === 'neutral' || f.side === 'admin');

    const embed = new EmbedBuilder()
      .setTitle('🏙️ Daftar Fraksi Roleplay')
      .setColor(0xFF6600)
      .setDescription('Pilih fraksimu dan ajukan ke admin!\nGunakan `!joinfraksi <nama_fraksi>` untuk bergabung.')
      .addFields(
        { name: '💀 BADSIDE (Kriminal)', value: badside.map(([k,f]) => f.emoji + ' **' + f.label + '** — ' + f.desc).join('\n') || '-' },
        { name: '⚖️ GOODSIDE (Pemerintahan)', value: goodside.map(([k,f]) => f.emoji + ' **' + f.label + '** — ' + f.desc).join('\n') || '-' },
        { name: '🎭 NETRAL', value: neutral.map(([k,f]) => f.emoji + ' **' + f.label + '** — ' + f.desc).join('\n') || '-' },
        { name: '📋 Cara Join', value: '`!joinfraksi <nama>` → Admin review → Disetujui/Ditolak' },
        { name: '💡 Contoh', value: '`!joinfraksi mafia` atau `!joinfraksi ems`' }
      )
      .setFooter({ text: 'Join fraksi perlu persetujuan admin!' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !joinfraksi ========================
  // User request join fraksi (butuh acc admin)
  if (command === 'joinfraksi') {
    if (!user) return message.reply('❌ Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);

    const fraksiKey = args[0]?.toLowerCase();
    if (!fraksiKey || !FRAKSI_LIST[fraksiKey]) {
      return message.reply('❌ Fraksi tidak valid! Gunakan `!fraksi` untuk melihat daftar.\nContoh: `!joinfraksi mafia`');
    }
    // BFL fraksi hanya bisa di-assign admin (kecuali admin sendiri yang minta)
    if (fraksiKey === 'bfl' && message.author.id !== ADMIN_ID) return message.reply('❌ Fraksi BFL hanya bisa di-assign oleh Admin.');

    if (user.fraksi) {
      return message.reply('❌ Kamu sudah di fraksi **' + FRAKSI_LIST[user.fraksi]?.label + '**! Hubungi admin untuk pindah fraksi.');
    }

    // ATURAN: Badside tidak bisa join Goodside dan sebaliknya
    // Admin bisa join fraksi manapun
    if (message.author.id !== ADMIN_ID) {
      // Cek history fraksi dari user lain yg sudah expired — lewati
      // Cek apakah target fraksi konflik dengan sisi user sebelumnya
      // (Berlaku jika user punya fraksi aktif — sudah dicek di atas, jadi aman)
    }

    // Cek pending request
    if (db.fraksiRequests[message.author.id]) {
      return message.reply('⏳ Kamu sudah punya request join fraksi yang sedang menunggu persetujuan admin.');
    }

    db.fraksiRequests[message.author.id] = {
      fraksi: fraksiKey,
      userId: message.author.id,
      userTag: message.author.tag,
      requestedAt: new Date().toISOString(),
    };
    saveDB(db);

    // Notif admin
    try {
      const adminUser = await client.users.fetch(ADMIN_ID);
      const f = FRAKSI_LIST[fraksiKey];
      await adminUser.send({ embeds: [
        new EmbedBuilder()
          .setTitle('📨 Request Join Fraksi Baru')
          .setColor(f.color)
          .addFields(
            { name: 'User', value: message.author.tag + ' (`' + message.author.id + '`)', inline: true },
            { name: 'Fraksi', value: f.emoji + ' ' + f.label, inline: true },
            { name: 'Setujui', value: '`!accfraksi ' + message.author.id + '`' },
            { name: 'Tolak', value: '`!tolakfraksi ' + message.author.id + '`' }
          )
      ]});
    } catch(e) {}

    const f = FRAKSI_LIST[fraksiKey];
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('📨 Request Join Fraksi Terkirim')
        .setColor(f.color)
        .setDescription('Request kamu untuk bergabung ke fraksi ' + f.emoji + ' **' + f.label + '** sudah dikirim ke admin!\nTunggu persetujuan.')
    ]});
  }

  // ======================== !accfraksi (admin) ========================
  if (command === 'accfraksi') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    if (!targetId) return message.reply('Format: `!accfraksi <discordId>`');
    const req = db.fraksiRequests[targetId];
    if (!req) return message.reply('❌ Tidak ada request dari user ini.');
    const targetUser = getUserByDiscordId(db, targetId);
    if (!targetUser) return message.reply('❌ User tidak ditemukan!');
    ensureUserFields(targetUser);

    // Cek konflik sisi (kecuali admin)
    if (targetId !== ADMIN_ID && targetUser.fraksiHistory) {
      const fBaru = FRAKSI_LIST[req.fraksi];
      const fLama = targetUser.fraksiHistory.map(k => FRAKSI_LIST[k]).filter(Boolean);
      const pernahBad = fLama.some(f => f.side === 'bad');
      const pernahGood = fLama.some(f => f.side === 'good');
      if (pernahBad && fBaru && fBaru.side === 'good') {
        return message.reply('❌ User ini pernah bergabung Badside dan tidak bisa join Goodside!');
      }
      if (pernahGood && fBaru && fBaru.side === 'bad') {
        return message.reply('❌ User ini pernah bergabung Goodside dan tidak bisa join Badside!');
      }
    }

    // Simpan history fraksi
    if (!targetUser.fraksiHistory) targetUser.fraksiHistory = [];
    if (req.fraksi && !targetUser.fraksiHistory.includes(req.fraksi)) {
      targetUser.fraksiHistory.push(req.fraksi);
    }

    targetUser.fraksi = req.fraksi;
    delete db.fraksiRequests[targetId];
    saveDB(db);
    const f = FRAKSI_LIST[req.fraksi];
    try {
      const u = await client.users.fetch(targetId);
      await u.send({ embeds: [
        new EmbedBuilder()
          .setTitle('✅ Request Fraksi Disetujui!')
          .setColor(f.color)
          .setDescription('Kamu resmi bergabung ke fraksi ' + f.emoji + ' **' + f.label + '**!\n\n' + f.desc)
          .addFields({ name: 'Sisi', value: f.side === 'bad' ? '💀 Badside' : f.side === 'good' ? '⚖️ Goodside' : '🎭 Netral' })
      ]});
    } catch(e) {}
    return message.reply('✅ ' + req.userTag + ' berhasil dimasukkan ke fraksi ' + f.emoji + ' **' + f.label + '**!');
  }

  // ======================== !tolakfraksi (admin) ========================
  if (command === 'tolakfraksi') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    if (!targetId) return message.reply('Format: `!tolakfraksi <discordId>`');
    const req = db.fraksiRequests[targetId];
    if (!req) return message.reply('❌ Tidak ada request dari user ini.');
    delete db.fraksiRequests[targetId];
    saveDB(db);
    try {
      const u = await client.users.fetch(targetId);
      await u.send('❌ Request join fraksi **' + FRAKSI_LIST[req.fraksi]?.label + '** kamu ditolak oleh admin.');
    } catch(e) {}
    return message.reply('❌ Request fraksi dari ' + req.userTag + ' ditolak.');
  }

  // ======================== !berisenjata (admin — beri senjata ke Polisi/Tentara) ========================
  if (command === 'berisenjata') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const senjataKey = args[1]?.toLowerCase();
    if (!target || !senjataKey) return message.reply('Format: `!berisenjata @user <nama_senjata>`\nContoh: `!berisenjata @user ak47`\nSenjata: ' + Object.keys(SENJATA_LIST).join(', '));
    if (!SENJATA_LIST[senjataKey]) return message.reply('❌ Senjata tidak valid! Pilihan: ' + Object.keys(SENJATA_LIST).join(', '));
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ User belum terdaftar!');
    ensureUserFields(targetUser);
    const fUser = targetUser.fraksi ? FRAKSI_LIST[targetUser.fraksi] : null;
    const bolehDiberi = fUser && (fUser.side === 'bad' || fUser.side === 'good' || targetUser.fraksi === 'polisi' || targetUser.fraksi === 'tentara');
    if (!bolehDiberi && !fUser) return message.reply('❌ User belum punya fraksi!');
    const s = SENJATA_LIST[senjataKey];
    // Masukkan ke weapon inventory target
    if (!targetUser.weaponInv) targetUser.weaponInv = {};
    targetUser.weaponInv[senjataKey] = (targetUser.weaponInv[senjataKey] || 0) + 1;
    targetUser.senjata = senjataKey; // auto equip
    saveDB(db);
    try {
      await (await client.users.fetch(target.id)).send({ embeds: [
        new EmbedBuilder()
          .setTitle('🔫 Senjata Diberikan Admin!')
          .setColor(C_GREEN)
          .setDescription('Admin telah memberikanmu senjata ' + s.emoji + ' **' + s.name + '**!')
          .addFields(
            { name: '🔫 Senjata', value: s.emoji + ' ' + s.name, inline: true },
            { name: '💥 Damage', value: '⚡'.repeat(s.damage), inline: true },
            { name: '💡 Info', value: 'Gunakan `!war @user` untuk berperang!', inline: false }
          )
      ]});
    } catch(e) {}
    return message.reply('✅ Senjata ' + s.emoji + ' **' + s.name + '** berhasil diberikan ke **' + target.username + '** (' + (fUser ? fUser.label : 'no fraksi') + ')!');
  }

  // ======================== !setfraksi (admin - langsung assign) ========================
  if (command === 'setfraksi') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const fraksiKey = args[1]?.toLowerCase();
    if (!target || !fraksiKey) return message.reply('Format: `!setfraksi @user <fraksi>`');
    if (!FRAKSI_LIST[fraksiKey]) return message.reply('❌ Fraksi tidak valid!');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ User belum terdaftar!');
    ensureUserFields(targetUser);
    targetUser.fraksi = fraksiKey;
    saveDB(db);
    const f = FRAKSI_LIST[fraksiKey];
    try {
      await (await client.users.fetch(target.id)).send({ embeds: [
        new EmbedBuilder()
          .setTitle('👑 Fraksi Diset oleh Admin')
          .setColor(f.color)
          .setDescription('Admin telah memasukkanmu ke fraksi ' + f.emoji + ' **' + f.label + '**!')
      ]});
    } catch(e) {}
    return message.reply('✅ ' + target.username + ' dimasukkan ke fraksi ' + f.emoji + ' **' + f.label + '**!');
  }

  // ======================== !profil / !rp ========================
  // Cek profil roleplay diri sendiri atau orang lain
  if (command === 'rp' || command === 'profilrp') {
    const target = message.mentions.users.first();
    const targetId = target ? target.id : message.author.id;
    const rUser = getUserByDiscordId(db, targetId);
    if (!rUser) return message.reply('❌ User tidak ditemukan / belum terdaftar!');
    ensureUserFields(rUser);

    const f = rUser.fraksi ? FRAKSI_LIST[rUser.fraksi] : null;
    const s = rUser.senjata ? SENJATA_LIST[rUser.senjata] : null;
    const hpBar = (hp) => {
      const filled = Math.round((hp / 100) * 10);
      const empty = 10 - filled;
      const e = hp <= 0 ? '💀' : hp <= 30 ? '🔴' : hp <= 60 ? '🟡' : '🟢';
      return e + ' [' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + hp + '%';
    };

    // Weapon inventory summary
    const wInv = rUser.weaponInv || {};
    const wInvEntries = Object.entries(wInv).filter(([, qty]) => qty > 0);
    const wInvText = wInvEntries.length
      ? wInvEntries.map(([k, qty]) => { const ws = SENJATA_LIST[k]; return ws ? ws.emoji + ' ' + ws.name + ' x' + qty : k + ' x' + qty; }).join('\n')
      : '_(Kosong)_';

    const embed = new EmbedBuilder()
      .setTitle('🎭 Profil Roleplay — ' + (target ? target.username : message.author.username))
      .setColor(f ? f.color : 0x888888)
      .setThumbnail((target || message.author).displayAvatarURL())
      .addFields(
        { name: '🏷️ Fraksi', value: f ? (f.emoji + ' **' + f.label + '**') : '_(Belum bergabung fraksi)_', inline: true },
        { name: '⚔️ Sisi', value: f ? (f.side === 'bad' ? '💀 Badside' : f.side === 'good' ? '⚖️ Goodside' : f.side === 'admin' ? '👑 Admin' : '🎭 Netral') : '-', inline: true },
        { name: '❤️ HP', value: hpBar(rUser.hp), inline: false },
        { name: '🔫 Senjata Aktif', value: s ? (s.emoji + ' **' + s.name + '** (Harga: ' + s.harga.toLocaleString('id-ID') + ' BFL)') : '_(Tidak bersenjata)_', inline: true },
        { name: '📦 Inventory Senjata', value: wInvText, inline: true },
        { name: '💀 Status', value: rUser.isDead ? '💀 **MATI** — Butuh EMS!' : '✅ Hidup', inline: false },
        { name: '📊 Stats', value: '🏆 Kill: **' + rUser.kills + '** | ☠️ Death: **' + rUser.deaths + '**', inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !senjata ========================
  // Lihat daftar senjata + beli senjata
  if (command === 'senjata') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    // Jika ada args, berarti beli senjata
    const senjataKey = args[0]?.toLowerCase();

    // Tampilkan daftar senjata
    if (!senjataKey) {
      const embed = new EmbedBuilder()
        .setTitle('🔫 Toko Senjata — Badside Armory')
        .setColor(C_RED)
        .setDescription('⚠️ Senjata **HANYA** bisa dibeli oleh fraksi **Badside** (Mafia, Yakuza, Cartel, Gengster)!\nGoodside dan Netral tidak diperbolehkan memiliki senjata.\nGunakan `!senjata <nama>` untuk membeli.\n💡 Senjata yang dibeli masuk ke **inventory** (`!invsenjata`). Equip dengan `!equipsenjata <nama>`.\n🏷️ Jual senjata: `!jualsenjata <nama>` — harga **40%** dari harga beli.')
        .addFields(
          Object.entries(SENJATA_LIST).map(([k, s]) => ({
            name: s.emoji + ' ' + s.name,
            value: 'Harga Beli: **' + s.harga.toLocaleString('id-ID') + ' BFL**\nHarga Jual: **' + Math.floor(s.harga * 0.4).toLocaleString('id-ID') + ' BFL** (40%)\nDamage: ' + '⚡'.repeat(s.damage) + '\nBeli: `!senjata ' + k + '`',
            inline: true
          }))
        )
        .setFooter({ text: 'Senjata lebih mahal = win rate war lebih tinggi!' });
      return message.reply({ embeds: [embed] });
    }

    // Proses beli senjata
    const senjata = SENJATA_LIST[senjataKey];
    if (!senjata) return message.reply('❌ Senjata tidak ditemukan! Gunakan `!senjata` untuk melihat daftar.');

    // Cek fraksi — Badside bisa beli, Polisi/Tentara hanya bisa dapat dari admin (#3)
    const fraksiUser = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const bolehBeli = (fraksiUser && fraksiUser.side === 'bad') || message.author.id === ADMIN_ID;
    if (!bolehBeli) return message.reply('❌ Hanya fraksi **Badside** (Mafia, Yakuza, Cartel, Gengster, dll) yang bisa membeli senjata!\nFraksimu saat ini: ' + (fraksiUser ? fraksiUser.label : 'Belum bergabung') + '\n_(Polisi/Tentara hanya bisa dapat senjata dari Admin via `!berisenjata`)_');

    if (user.isDead) return message.reply('💀 Kamu sedang MATI! Minta EMS untuk mengobatimu dulu.');
    if (user.balance < senjata.harga) return message.reply('❌ Saldo tidak cukup! Harga ' + senjata.name + ': **' + senjata.harga.toLocaleString('id-ID') + ' BFL**');

    // Masukkan ke weapon inventory
    if (!user.weaponInv) user.weaponInv = {};
    user.weaponInv[senjataKey] = (user.weaponInv[senjataKey] || 0) + 1;
    user.balance -= senjata.harga;
    sendToAdmin(db, senjata.harga);
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🔫 Senjata Dibeli!')
        .setColor(C_RED)
        .setDescription('Kamu berhasil membeli ' + senjata.emoji + ' **' + senjata.name + '** dan masuk ke inventory!')
        .addFields(
          { name: '💰 Harga', value: '-' + senjata.harga.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '💥 Damage', value: '⚡'.repeat(senjata.damage), inline: true },
          { name: '📦 Inventory', value: '`!invsenjata` — lihat inventory senjatamu', inline: false },
          { name: '💡 Equip', value: '`!equipsenjata ' + senjataKey + '` — pasang sebagai senjata aktif', inline: false }
        )
    ]});
  }

  // ======================== !invsenjata ========================
  // Lihat inventory senjata yang dimiliki
  if (command === 'invsenjata') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    if (!user.weaponInv) user.weaponInv = {};

    const ownedEntries = Object.entries(user.weaponInv).filter(([, qty]) => qty > 0);
    const equipped = user.senjata ? SENJATA_LIST[user.senjata] : null;

    if (!ownedEntries.length) {
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('📦 Inventory Senjata')
          .setColor(C_RED)
          .setDescription('Kamu tidak punya senjata di inventory!\nBeli dengan `!senjata <nama>`')
          .addFields(
            { name: '🔫 Senjata Aktif (Equipped)', value: equipped ? (equipped.emoji + ' ' + equipped.name) : '_(Tidak ada)_', inline: false }
          )
      ]});
    }

    const invList = ownedEntries.map(([k, qty]) => {
      const s = SENJATA_LIST[k];
      const isEquipped = user.senjata === k;
      const jualHarga = Math.floor(s.harga * 0.4);
      return (isEquipped ? '✅ **[EQUIPPED]** ' : '') + s.emoji + ' **' + s.name + '** x' + qty + '\nDamage: ' + '⚡'.repeat(s.damage) + ' | Jual: ' + jualHarga.toLocaleString('id-ID') + ' BFL/pcs';
    }).join('\n\n');

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('📦 Inventory Senjata — ' + message.author.username)
        .setColor(C_RED)
        .setDescription(invList)
        .addFields(
          { name: '🔫 Senjata Aktif', value: equipped ? (equipped.emoji + ' ' + equipped.name + ' (Damage: ' + '⚡'.repeat(equipped.damage) + ')') : '_(Tidak ada — gunakan !equipsenjata)_', inline: false },
          { name: '💡 Command', value: '`!equipsenjata <nama>` — Pasang senjata\n`!jualsenjata <nama> [jumlah]` — Jual senjata (40% harga toko)', inline: false }
        )
    ]});
  }

  // ======================== !equipsenjata ========================
  // Pasang senjata dari inventory sebagai senjata aktif
  if (command === 'equipsenjata') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    if (!user.weaponInv) user.weaponInv = {};

    const senjataKey = args[0]?.toLowerCase();
    if (!senjataKey) return message.reply('❌ Format: `!equipsenjata <nama_senjata>`\nContoh: `!equipsenjata ak47`\nLihat inventory: `!invsenjata`');

    const senjata = SENJATA_LIST[senjataKey];
    if (!senjata) return message.reply('❌ Senjata tidak valid! Gunakan `!senjata` untuk lihat daftar.');

    if (!user.weaponInv[senjataKey] || user.weaponInv[senjataKey] < 1) {
      return message.reply('❌ Kamu tidak punya **' + senjata.name + '** di inventory!\nBeli dulu: `!senjata ' + senjataKey + '`');
    }

    user.senjata = senjataKey;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Senjata Dipasang!')
        .setColor(C_GREEN)
        .setDescription('Kamu sekarang menggunakan ' + senjata.emoji + ' **' + senjata.name + '** sebagai senjata aktif!')
        .addFields(
          { name: '💥 Damage', value: '⚡'.repeat(senjata.damage), inline: true },
          { name: '⚔️ Siap Perang', value: '`!war @user` untuk berperang!', inline: true }
        )
    ]});
  }

  // ======================== !jualsenjata ========================
  // Jual senjata dari inventory dengan harga 40% dari harga toko
  if (command === 'jualsenjata') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);
    if (!user.weaponInv) user.weaponInv = {};

    const senjataKey = args[0]?.toLowerCase();
    const jumlahJual = parseInt(args[1]) || 1;

    if (!senjataKey) return message.reply('❌ Format: `!jualsenjata <nama_senjata> [jumlah]`\nContoh: `!jualsenjata p50` atau `!jualsenjata ak47 2`\nLihat inventory: `!invsenjata`');

    const senjata = SENJATA_LIST[senjataKey];
    if (!senjata) return message.reply('❌ Senjata tidak valid! Gunakan `!senjata` untuk lihat daftar.');

    const dimiliki = user.weaponInv[senjataKey] || 0;
    if (dimiliki < jumlahJual) {
      return message.reply('❌ Kamu hanya punya **' + dimiliki + 'x ' + senjata.name + '** di inventory! Tidak bisa jual ' + jumlahJual + '.');
    }

    // Tidak bisa jual senjata yang sedang diequip jika itu satu-satunya
    if (user.senjata === senjataKey && dimiliki <= jumlahJual) {
      // Akan melepas equipped jika semua dijual
      user.senjata = null;
    }

    const hargaJual = Math.floor(senjata.harga * 0.4);
    const totalPendapatan = hargaJual * jumlahJual;

    user.weaponInv[senjataKey] -= jumlahJual;
    if (user.weaponInv[senjataKey] <= 0) delete user.weaponInv[senjataKey];
    user.balance += totalPendapatan;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('💰 Senjata Berhasil Dijual!')
        .setColor(C_GREEN)
        .setDescription('Kamu menjual **' + jumlahJual + 'x ' + senjata.emoji + ' ' + senjata.name + '**!')
        .addFields(
          { name: '🏷️ Harga Toko', value: senjata.harga.toLocaleString('id-ID') + ' BFL/pcs', inline: true },
          { name: '💵 Harga Jualmu (40%)', value: hargaJual.toLocaleString('id-ID') + ' BFL/pcs', inline: true },
          { name: '💰 Total Diterima', value: '+' + totalPendapatan.toLocaleString('id-ID') + ' BFL', inline: false },
          { name: '📦 Sisa Inventory', value: (user.weaponInv[senjataKey] || 0) + 'x ' + senjata.name, inline: true }
        )
        .setFooter({ text: 'Harga jual = 40% dari harga toko' })
    ]});
  }

  // ======================== !war ========================
  // Tantang user lain perang
  if (command === 'war') {
    if (isDM) return message.reply('❌ Command `!war` hanya bisa di server!');
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Format: `!war @user`');
    if (target.id === message.author.id) return message.reply('❌ Tidak bisa perang dengan diri sendiri!');
    if (target.bot) return message.reply('❌ Tidak bisa perang dengan bot!');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ ' + target.username + ' belum terdaftar!');
    ensureUserFields(targetUser);

    // Validasi
    if (user.isDead) return message.reply('💀 Kamu sedang MATI! Minta EMS untuk mengobatimu dulu.');
    if (targetUser.isDead) return message.reply('💀 ' + target.username + ' sedang MATI! Tidak bisa diperangi.');
    if (user.inWar) return message.reply('⚔️ Kamu sedang dalam perang! Selesaikan dulu.');
    if (targetUser.inWar) return message.reply('⚔️ ' + target.username + ' sedang dalam perang lain!');
    if (!user.senjata) return message.reply('❌ Kamu tidak punya senjata! Beli dulu dengan `!senjata`');

    // Validasi fraksi untuk war
    // Aturan: Badside vs Badside BOLEH. Badside vs Polisi/Tentara BOLEH.
    // Badside TIDAK BOLEH war lawan: EMS, Civilian, Hacker, Freelancer
    const FRAKSI_NO_WAR = ['ems', 'civilian', 'hacker', 'freelancer'];
    const fChallenger = user.fraksi ? FRAKSI_LIST[user.fraksi] : null;
    const fTarget = targetUser.fraksi ? FRAKSI_LIST[targetUser.fraksi] : null;
    const isChallengerBad = fChallenger && fChallenger.side === 'bad';
    const isTargetBad = fTarget && fTarget.side === 'bad';
    const isTargetLawEnforcement = targetUser.fraksi === 'polisi' || targetUser.fraksi === 'tentara';
    const isTargetNoWar = FRAKSI_NO_WAR.includes(targetUser.fraksi);
    const isAdminWar = message.author.id === ADMIN_ID;
    if (!isAdminWar) {
      if (!isChallengerBad) {
        return message.reply('❌ Hanya fraksi **Badside** yang bisa menantang war!\nFraksimu: ' + (fChallenger ? fChallenger.label : 'Belum bergabung'));
      }
      if (isTargetNoWar) {
        const noWarLabel = fTarget ? fTarget.label : targetUser.fraksi;
        return message.reply('❌ Fraksi **' + noWarLabel + '** tidak bisa dijadikan target war!\nTarget war yang valid: **Badside** (Mafia/Yakuza/Cartel/Gengster) atau **Polisi/Tentara**.');
      }
      if (!isTargetBad && !isTargetLawEnforcement) {
        return message.reply('❌ Target war harus fraksi **Badside** (Mafia/Yakuza/Cartel/Gengster) atau **Polisi/Tentara**!\nFraksi target: ' + (fTarget ? fTarget.label : 'Belum bergabung'));
      }
    }

    // Kirim tantangan — target harus ACC atau TOLAK dulu
    const senjataA = SENJATA_LIST[user.senjata] || null;
    const senjataB = targetUser.senjata ? SENJATA_LIST[targetUser.senjata] : null;
    const senjataALabel = senjataA ? (senjataA.emoji + ' ' + senjataA.name) : '_(tangan kosong)_';
    const senjataBLabel = senjataB ? (senjataB.emoji + ' ' + senjataB.name) : '_(tangan kosong)_';

    // Simpan war pending
    db.warPending[target.id] = {
      challengerId: message.author.id,
      challengerTag: message.author.tag,
      targetId: target.id,
      targetTag: target.tag,
      channelId: message.channel.id,
      timestamp: Date.now(),
    };
    saveDB(db);

    const challengeEmbed = new EmbedBuilder()
      .setTitle('⚔️ TANTANGAN PERANG!')
      .setColor(C_RED)
      .setDescription('<@' + target.id + '>! **' + message.author.username + '** menantangmu PERANG!\n\n⚠️ Yang kalah akan **MATI** dan butuh **EMS** (100.000 BFL) untuk sembuh!')
      .addFields(
        { name: '🔫 ' + message.author.username + ' (Penantang)', value: senjataALabel, inline: true },
        { name: '🔫 ' + target.username + ' (Ditantang)', value: senjataBLabel, inline: true },
        { name: '💰 Taruhan', value: 'Pemenang dapat **20% saldo** + senjata lawan!', inline: false },
        { name: '✅ Terima / ❌ Tolak', value: '`!accwar` — Terima tantangan\n`!tolakwar` — Tolak tantangan\n_Tantangan expired dalam 2 menit_', inline: false }
      );

    await message.channel.send({ embeds: [challengeEmbed] });

    // Auto-expire jika tidak di-acc dalam 2 menit
    setTimeout(() => {
      const dbNow = loadDB();
      if (dbNow.warPending[target.id] && dbNow.warPending[target.id].challengerId === message.author.id) {
        delete dbNow.warPending[target.id];
        saveDB(dbNow);
        message.channel.send('⌛ Tantangan war dari **' + message.author.username + '** ke **' + target.username + '** expired!').catch(() => {});
      }
    }, 2 * 60 * 1000);
    return;
  }

  // ======================== !accwar ========================
  // Target menerima tantangan war
  if (command === 'accwar') {
    if (isDM) return message.reply('❌ Command ini hanya bisa di server!');
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    const pending = db.warPending[message.author.id];
    if (!pending) return message.reply('❌ Kamu tidak punya tantangan war yang menunggu!');

    const challenger = getUserByDiscordId(db, pending.challengerId);
    if (!challenger) {
      delete db.warPending[message.author.id];
      saveDB(db);
      return message.reply('❌ Penantang tidak ditemukan!');
    }
    ensureUserFields(challenger);

    // Validasi ulang sebelum mulai
    if (user.isDead) return message.reply('💀 Kamu sedang MATI! Tidak bisa menerima tantangan war.');
    if (challenger.isDead) return message.reply('💀 Penantang sudah mati!');
    if (user.inWar || challenger.inWar) return message.reply('⚔️ Salah satu pihak sedang dalam perang!');
    if (user.jailUntil && Date.now() < user.jailUntil) return message.reply('🔒 Kamu di **PENJARA**! Tidak bisa ikut war.');
    if (challenger.jailUntil && Date.now() < challenger.jailUntil) return message.reply('🔒 Penantang sedang di **PENJARA**!');

    // Hapus pending
    delete db.warPending[message.author.id];

    // Mulai war session
    const warId = pending.challengerId + '_' + message.author.id + '_' + Date.now();
    const senjataA = SENJATA_LIST[challenger.senjata] || null;
    const senjataB = SENJATA_LIST[user.senjata] || null;

    let wrA = 50, wrB = 50;
    if (senjataA && senjataB) {
      if (senjataA.harga > senjataB.harga) { wrA = 70; wrB = 30; }
      else if (senjataB.harga > senjataA.harga) { wrA = 30; wrB = 70; }
    } else if (senjataA && !senjataB) {
      wrA = 80; wrB = 20;
    } else if (!senjataA && senjataB) {
      wrA = 20; wrB = 80;
    }

    db.warSessions[warId] = {
      id: warId,
      challengerId: pending.challengerId,
      challengerTag: pending.challengerTag,
      targetId: message.author.id,
      targetTag: message.author.tag,
      senjataChallenger: challenger.senjata || null,
      senjataTarget: user.senjata || null,
      wrChallenger: wrA,
      wrTarget: wrB,
      round: 0,
      hitsChallenger: 0,
      hitsTarget: 0,
      startedAt: Date.now(),
      status: 'active',
      channelId: message.channel.id,
    };

    challenger.inWar = true;
    user.inWar = true;
    saveDB(db);

    const senjataALabel = senjataA ? (senjataA.emoji + ' ' + senjataA.name) : '_(tangan kosong)_';
    const senjataBLabel = senjataB ? (senjataB.emoji + ' ' + senjataB.name) : '_(tangan kosong)_';

    const startEmbed = new EmbedBuilder()
      .setTitle('⚔️ PERANG DIMULAI!')
      .setColor(C_RED)
      .setDescription('<@' + pending.challengerId + '> vs <@' + message.author.id + '>\n\n🕐 Perang berlangsung **2 menit** dengan **5 ronde tembakan**!')
      .addFields(
        { name: '🔫 ' + pending.challengerTag.split('#')[0], value: senjataALabel + '\nWin Rate: **' + wrA + '%**', inline: true },
        { name: '🔫 ' + message.author.username, value: senjataBLabel + '\nWin Rate: **' + wrB + '%**', inline: true },
        { name: '⏱️ Durasi', value: '2 menit / 5 ronde', inline: false },
        { name: '💰 Taruhan', value: '20% dari saldo pemenang didapat dari saldo yang kalah\nSenjata kalah berpindah ke pemenang!', inline: false },
        { name: '⚠️ Note', value: 'Yang kalah akan MATI dan butuh EMS (biaya 100.000 BFL) untuk sembuh!', inline: false }
      );

    const warMsg = await message.channel.send({ embeds: [startEmbed] });

    // Jalankan 5 ronde tembakan tiap 20 detik
    let round = 0;
    const roundInterval = setInterval(async () => {
      round++;
      const db2 = loadDB();
      const session = db2.warSessions[warId];
      if (!session || session.status !== 'active') { clearInterval(roundInterval); return; }

      // Simulasikan tembakan ronde ini
      const rollA = Math.random() * 100;
      const rollB = Math.random() * 100;
      let hitA = rollA < session.wrChallenger; // A mengenai B
      let hitB = rollB < session.wrTarget;     // B mengenai A

      if (hitA) session.hitsChallenger++;
      if (hitB) session.hitsTarget++;
      session.round = round;
      db2.warSessions[warId] = session;
      saveDB(db2);

      const roundEmbed = new EmbedBuilder()
        .setTitle('💥 RONDE ' + round + ' / 5')
        .setColor(0xFF6600)
        .setDescription(
          (hitA ? '🎯 **' + session.challengerTag.split('#')[0] + '** menembak dan **MENGENAI** target!' : '💨 **' + session.challengerTag.split('#')[0] + '** tembak tapi **MELESET!**') + '\n' +
          (hitB ? '🎯 **' + session.targetTag.split('#')[0] + '** membalas dan **MENGENAI**!' : '💨 **' + session.targetTag.split('#')[0] + '** balas tapi **MELESET!**')
        )
        .addFields(
          { name: '📊 Skor Tembakan', value: '**' + session.challengerTag.split('#')[0] + '**: ' + session.hitsChallenger + ' hit\n**' + session.targetTag.split('#')[0] + '**: ' + session.hitsTarget + ' hit', inline: false }
        )
        .setFooter({ text: round < 5 ? 'Ronde berikutnya dalam 20 detik...' : 'RONDE TERAKHIR!' });

      try { await message.channel.send({ embeds: [roundEmbed] }); } catch(e) {}

      // Setelah ronde 5, tentukan pemenang
      if (round >= 5) {
        clearInterval(roundInterval);
        setTimeout(async () => {
          const db3 = loadDB();
          const sess = db3.warSessions[warId];
          if (!sess || sess.status !== 'active') return;

          sess.status = 'finished';
          const cUser = getUserByDiscordId(db3, sess.challengerId);
          const tUser = getUserByDiscordId(db3, sess.targetId);
          if (!cUser || !tUser) { saveDB(db3); return; }
          ensureUserFields(cUser);
          ensureUserFields(tUser);

          // Tentukan pemenang berdasarkan WR (final roll dengan WR)
          // Hits lebih banyak menang, jika sama gunakan WR roll
          let winnerId, loserId, winnerUser, loserUser, winnerTag, loserTag;
          if (sess.hitsChallenger > sess.hitsTarget) {
            winnerId = sess.challengerId; loserId = sess.targetId;
            winnerUser = cUser; loserUser = tUser;
            winnerTag = sess.challengerTag; loserTag = sess.targetTag;
          } else if (sess.hitsTarget > sess.hitsChallenger) {
            winnerId = sess.targetId; loserId = sess.challengerId;
            winnerUser = tUser; loserUser = cUser;
            winnerTag = sess.targetTag; loserTag = sess.challengerTag;
          } else {
            // Sama - final WR roll
            const finalRoll = Math.random() * 100;
            if (finalRoll < sess.wrChallenger) {
              winnerId = sess.challengerId; loserId = sess.targetId;
              winnerUser = cUser; loserUser = tUser;
              winnerTag = sess.challengerTag; loserTag = sess.targetTag;
            } else {
              winnerId = sess.targetId; loserId = sess.challengerId;
              winnerUser = tUser; loserUser = cUser;
              winnerTag = sess.targetTag; loserTag = sess.challengerTag;
            }
          }

          // Hitung hadiah: 20% dari saldo loser
          const prize = Math.floor(loserUser.balance * 0.20);
          winnerUser.balance += prize;
          loserUser.balance = Math.max(0, loserUser.balance - prize);

          // Transfer senjata loser ke winner (masuk inventory pemenang)
          const loserSenjata = loserUser.senjata;
          const loserSenjataObj = loserSenjata ? SENJATA_LIST[loserSenjata] : null;
          if (loserSenjata) {
            if (!winnerUser.weaponInv) winnerUser.weaponInv = {};
            winnerUser.weaponInv[loserSenjata] = (winnerUser.weaponInv[loserSenjata] || 0) + 1;
            winnerUser.senjata = loserSenjata; // auto equip senjata rampasan
            // Hapus dari inventory loser
            if (!loserUser.weaponInv) loserUser.weaponInv = {};
            if (loserUser.weaponInv[loserSenjata] > 1) {
              loserUser.weaponInv[loserSenjata] -= 1;
            } else {
              delete loserUser.weaponInv[loserSenjata];
            }
            loserUser.senjata = null;
          }

          // Loser mati
          loserUser.isDead = true;
          loserUser.hp = 0;
          loserUser.deaths = (loserUser.deaths || 0) + 1;
          winnerUser.kills = (winnerUser.kills || 0) + 1;

          // Reset war flag
          cUser.inWar = false;
          tUser.inWar = false;
          delete db3.warSessions[warId];
          saveDB(db3);

          const endEmbed = new EmbedBuilder()
            .setTitle('🏆 PERANG SELESAI!')
            .setColor(C_GOLD)
            .setDescription(
              '━━━━━━━━━━━━━━━━━━━━━━━\n' +
              '🏆 **PEMENANG:** ' + winnerTag.split('#')[0] + '\n' +
              '☠️ **KALAH:** ' + loserTag.split('#')[0] + '\n' +
              '━━━━━━━━━━━━━━━━━━━━━━━'
            )
            .addFields(
              { name: '📊 Skor Akhir', value: '🔫 **' + sess.challengerTag.split('#')[0] + '**: ' + sess.hitsChallenger + ' hit\n🔫 **' + sess.targetTag.split('#')[0] + '**: ' + sess.hitsTarget + ' hit', inline: false },
              { name: '🏆 ' + winnerTag.split('#')[0] + ' — MENANG', value: '+' + prize.toLocaleString('id-ID') + ' BFL (20% dari saldo lawan)\n' + (loserSenjataObj ? ('🔫 Dapat senjata: ' + loserSenjataObj.emoji + ' ' + loserSenjataObj.name) : 'Tidak ada senjata rampasan'), inline: false },
              { name: '☠️ ' + loserTag.split('#')[0] + ' — KALAH & MATI', value: 'HP = 0, butuh EMS untuk sembuh!\n`!ems @' + loserTag.split('#')[0] + '`\nBiaya EMS: **100.000 BFL** (dari saldo pasien)', inline: false }
            )
            .setFooter({ text: 'Yang kalah hanya bisa disembuhkan oleh fraksi EMS!' });

          try { await message.channel.send({ embeds: [endEmbed] }); } catch(e) {}
        }, 2000);
      }
    }, WAR_SHOOT_INTERVAL);
  }

  // ======================== !tolakwar ========================
  // Target menolak tantangan war
  if (command === 'tolakwar') {
    if (isDM) return message.reply('❌ Command ini hanya bisa di server!');
    if (!user) return message.reply('❌ Belum terdaftar!');

    const pending = db.warPending[message.author.id];
    if (!pending) return message.reply('❌ Kamu tidak punya tantangan war yang menunggu!');

    const challengerTag = pending.challengerTag;
    delete db.warPending[message.author.id];
    saveDB(db);

    return message.channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('❌ Tantangan War Ditolak')
        .setColor(C_ORANGE)
        .setDescription('**' + message.author.username + '** menolak tantangan war dari **' + challengerTag.split('#')[0] + '**.\n_Tantangan dibatalkan._')
    ]});
  }
  // EMS mengobati user yang mati (hanya fraksi EMS)
  if (command === 'ems') {
    if (!user) return message.reply('❌ Belum terdaftar!');
    ensureUserFields(user);

    // Cek apakah user adalah EMS
    if (user.fraksi !== 'ems' && message.author.id !== ADMIN_ID) {
      return message.reply('❌ Hanya anggota fraksi **EMS** yang bisa mengobati!\n_(Admin juga bisa menggunakan command ini)_');
    }

    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Format: `!ems @user`\nHanya bisa mengobati user yang MATI.');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ ' + target.username + ' belum terdaftar!');
    ensureUserFields(targetUser);

    if (!targetUser.isDead) return message.reply('❌ ' + target.username + ' tidak sedang mati! HP: ' + targetUser.hp + '%');

    // Cek saldo target untuk bayar EMS
    if (targetUser.balance < EMS_HEAL_PRICE) {
      return message.reply('❌ Saldo ' + target.username + ' tidak cukup untuk biaya EMS!\nBiaya EMS: **' + EMS_HEAL_PRICE.toLocaleString('id-ID') + ' BFL**\nSaldo mereka: **' + targetUser.balance.toLocaleString('id-ID') + ' BFL**');
    }

    // Bayar EMS
    targetUser.balance -= EMS_HEAL_PRICE;
    user.balance += Math.floor(EMS_HEAL_PRICE * 0.8); // EMS dapat 80%
    sendToAdmin(db, Math.floor(EMS_HEAL_PRICE * 0.2)); // Admin dapat 20%

    // Sembuhkan
    targetUser.isDead = false;
    targetUser.hp = 100;
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🚑 EMS — Pasien Diselamatkan!')
      .setColor(C_GREEN)
      .setDescription('<@' + target.id + '> berhasil diselamatkan oleh EMS <@' + message.author.id + '>!')
      .addFields(
        { name: '💊 Biaya EMS', value: EMS_HEAL_PRICE.toLocaleString('id-ID') + ' BFL (dari saldo pasien)', inline: true },
        { name: '❤️ HP', value: '100%', inline: true },
        { name: '💰 Pendapatan EMS', value: '+' + Math.floor(EMS_HEAL_PRICE * 0.8).toLocaleString('id-ID') + ' BFL', inline: true }
      );
    return message.channel.send({ embeds: [embed] });
  }

  // ======================== !fraksiinfo ========================
  // Info fraksi user atau target
  if (command === 'fraksiinfo') {
    const target = message.mentions.users.first();
    const tId = target ? target.id : message.author.id;
    const tUser = getUserByDiscordId(db, tId);
    if (!tUser) return message.reply('❌ User tidak ditemukan / belum terdaftar!');
    ensureUserFields(tUser);
    const f = tUser.fraksi ? FRAKSI_LIST[tUser.fraksi] : null;
    if (!f) return message.reply((target ? target.username : 'Kamu') + ' belum bergabung ke fraksi manapun.');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle(f.emoji + ' Fraksi: ' + f.label)
        .setColor(f.color)
        .setDescription(f.desc)
        .addFields({ name: 'Anggota', value: (target ? target.username : message.author.username), inline: true },
                   { name: 'Sisi', value: f.side === 'bad' ? '💀 Badside' : f.side === 'good' ? '⚖️ Goodside' : '👑 Admin', inline: true })
    ]});
  }

  // ======================== !listrequestfraksi (admin) ========================
  if (command === 'listrequestfraksi') {
    if (message.author.id !== ADMIN_ID) return;
    const reqs = Object.values(db.fraksiRequests || {});
    if (!reqs.length) return message.reply('Tidak ada request fraksi yang pending.');
    const list = reqs.map(r => {
      const f = FRAKSI_LIST[r.fraksi];
      return '• **' + r.userTag + '** (`' + r.userId + '`) → ' + (f ? f.emoji + ' ' + f.label : r.fraksi);
    }).join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('📋 Request Fraksi Pending')
        .setColor(C_ORANGE)
        .setDescription(list)
        .setFooter({ text: 'Gunakan !accfraksi <id> atau !tolakfraksi <id>' })
    ]});
  }

  // ======================== !emsforce (admin — sembuhkan paksa gratis) ========================
  if (command === 'emsforce') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    if (!target) return message.reply('Format: `!emsforce @user`');
    const tUser = getUserByDiscordId(db, target.id);
    if (!tUser) return message.reply('User tidak ditemukan!');
    ensureUserFields(tUser);
    tUser.isDead = false;
    tUser.hp = 100;
    tUser.inWar = false;
    saveDB(db);
    try { await (await client.users.fetch(target.id)).send('🚑 Admin telah mensembuhkanmu! HP kamu kembali 100%.'); } catch(e) {}
    return message.reply('✅ ' + target.username + ' berhasil disembuhkan oleh admin!');
  }

  // ======================== !resetwar (admin — reset war yang stuck) ========================
  if (command === 'resetwar') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    if (target) {
      // Reset war flag user tertentu
      const tUser = getUserByDiscordId(db, target.id);
      if (!tUser) return message.reply('❌ User tidak ditemukan!');
      ensureUserFields(tUser);
      tUser.inWar = false;
      // Hapus semua war session yang melibatkan user ini
      for (const [warId, sess] of Object.entries(db.warSessions || {})) {
        if (sess.challengerId === target.id || sess.targetId === target.id) {
          // Reset inWar untuk kedua pihak
          const otherUser = getUserByDiscordId(db, sess.challengerId === target.id ? sess.targetId : sess.challengerId);
          if (otherUser) { ensureUserFields(otherUser); otherUser.inWar = false; }
          delete db.warSessions[warId];
        }
      }
      saveDB(db);
      return message.reply('✅ War flag ' + target.username + ' berhasil direset!');
    }
    // Reset SEMUA war yang stuck
    let resetCount = 0;
    for (const [warId, sess] of Object.entries(db.warSessions || {})) {
      // Anggap stuck jika lebih dari 5 menit
      if (Date.now() - sess.startedAt > 5 * 60 * 1000) {
        const cu = getUserByDiscordId(db, sess.challengerId);
        const tu = getUserByDiscordId(db, sess.targetId);
        if (cu) { ensureUserFields(cu); cu.inWar = false; }
        if (tu) { ensureUserFields(tu); tu.inWar = false; }
        delete db.warSessions[warId];
        resetCount++;
      }
    }
    // Juga reset semua inWar flag dari user yang tidak ada war session aktif
    const activeWarIds = new Set();
    for (const sess of Object.values(db.warSessions || {})) {
      activeWarIds.add(sess.challengerId);
      activeWarIds.add(sess.targetId);
    }
    for (const u of Object.values(db.users)) {
      if (u.inWar && !activeWarIds.has(u.discordId)) {
        u.inWar = false;
        resetCount++;
      }
    }
    saveDB(db);
    return message.reply('✅ Reset selesai! ' + resetCount + ' war/flag stuck dibersihkan.\nGunakan `!resetwar @user` untuk reset spesifik satu user.');
  }

  // ======================== !warleaderboard ========================
  if (command === 'warleaderboard' || command === 'leaderboardwar') {
    const players = Object.values(db.users)
      .filter(u => u.kills > 0 || u.deaths > 0)
      .sort((a, b) => (b.kills || 0) - (a.kills || 0))
      .slice(0, 10);
    if (!players.length) return message.reply('Belum ada data war!');
    const list = players.map((u, i) =>
      (i + 1) + '. **' + (u.discordTag || u.noHp) + '** — 🏆 Kill: ' + (u.kills || 0) + ' | ☠️ Death: ' + (u.deaths || 0) + (u.fraksi ? ' | ' + (FRAKSI_LIST[u.fraksi]?.emoji || '') + ' ' + (FRAKSI_LIST[u.fraksi]?.label || u.fraksi) : '')
    ).join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🏆 War Leaderboard — Top Killer')
        .setColor(C_RED)
        .setDescription(list)
    ]});
  }

});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
