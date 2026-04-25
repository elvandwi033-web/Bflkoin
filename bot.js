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

// Uang awal saat registrasi
const STARTING_BALANCE     = 200000; // #3: 200.000 BFL
const STARTING_BALANCE_IDR = 1000;   // #8: 1.000 IDR

// Harga beli ayam sabung
const AYAM_PRICE = 20000;

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
  if (user.hunger === undefined)        user.hunger = 100;
  if (user.activityCount === undefined) user.activityCount = 0;
  if (user.chickens === undefined)      user.chickens = [];
  if (user.lastCoupon === undefined)    user.lastCoupon = null;
  if (user.balanceIDR === undefined)    user.balanceIDR = 0;
  return user;
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

// #6: VIP bayar pajak 5%, non-VIP 20%
function applyTax(db, user, profit) {
  if (profit > TAX_THRESHOLD) {
    const rate = user.isVIP ? TAX_RATE_VIP : TAX_RATE;
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

// #12: Tabel mancing/tambang IDR (WR 35:65, hadiah 200-6000 IDR, biaya mancing 500 IDR)
const FISH_TABLE_IDR = [
  { name: 'Ikan Busuk IDR',     price: 0,    weight: 35 },
  { name: 'Ikan Kecil IDR',     price: 200,  weight: 30 },
  { name: 'Ikan Mas IDR',       price: 800,  weight: 20 },
  { name: 'Ikan Kerapu IDR',    price: 2000, weight: 10 },
  { name: 'Ikan Langka IDR',    price: 6000, weight: 5  },
];

const MINE_TABLE_IDR = [
  { name: 'Sampah IDR',     price: 0,    weight: 35 },
  { name: 'Batu IDR',       price: 200,  weight: 30 },
  { name: 'Silver IDR',     price: 800,  weight: 20 },
  { name: 'Gold IDR',       price: 2000, weight: 10 },
  { name: 'Berlian IDR',    price: 6000, weight: 5  },
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

  // ======================== !help ========================
  if (command === 'help') {
    if (!isDM) return message.reply('❌ Command !help hanya bisa digunakan di DM bot!\nKlik nama bot → Kirim Pesan, lalu ketik !help');

    const foodPrice = db.foodConfig ? db.foodConfig.price : DEFAULT_FOOD_PRICE;
    const foodName  = db.foodConfig ? db.foodConfig.name  : 'Makan & Minum';
    const embed = new EmbedBuilder()
      .setTitle('BFL Coin Bot - Panduan Lengkap')
      .setColor(C_GOLD)
      .setDescription('1 BFL = 1 Rupiah Indonesia\nRegister, cek saldo & profil hanya di DM bot ini!')
      .addFields(
        { name: '📩 REGISTRASI (DM Bot)', value: '`!register` — Langsung daftar pakai username Discord!' },
        { name: '💰 CEK SALDO (DM Bot)', value: '`!saldo` — Cek saldo BFL\n`!saldoidr` — Cek saldo IDR' },
        { name: '👤 PROFIL (DM Bot)', value: '`!profile`' },
        { name: '❤️ CEK NYAWA', value: '`!nyawa` - Cek status makan & minum kamu' },
        { name: '🍱 BELI MAKAN', value: '`!beli makan` - Beli **' + foodName + '** seharga **' + foodPrice.toLocaleString('id-ID') + ' BFL**\n*(Wajib punya nyawa > 0% untuk beraktivitas!)*' },
        { name: '🍱 BERI MAKAN', value: '`!give makan @user` — Beri makan dari kantongmu ke orang lain' },
        { name: '🎁 TIP', value: '`!tip @user <jumlah>`' },
        { name: '🌧️ RAIN / PARTY', value: '`!rain <jumlah>` - Bagikan ke yang aktif di channel' },
        { name: '🎲 DADU 1v1 (BFL/IDR)', value: '`!dadu @user <taruhan>` - BFL\n`!daduidr @user <taruhan>` - IDR' },
        { name: '🎰 SLOT (BFL/IDR)', value: '`!slot <taruhan>` - BFL (WR 50:50)\n`!slotidr <taruhan>` - IDR (WR 30:70)' },
        { name: '🎰 BONANZA SLOT', value: '`!bonanza <taruhan>` - Slot Bonanza BFL\n`!bonanza beli` - Beli fitur Bonanza 100.000 BFL' },
        { name: '🎣 MEMANCING (BFL/IDR)', value: '`!mancing` - Bayar 500 BFL\n`!mancingidr` - Bayar 500 IDR\n`!jual ikan` - Jual semua ikan' },
        { name: '⛏️ MENAMBANG (BFL/IDR)', value: '`!tambang` - Bayar 200 BFL\n`!tambangidr` - Bayar 200 IDR\n`!jual tambang` - Jual semua material' },
        { name: '🎮 PARTY CASINO (Maks 5 orang)', value: '`!party casino` - Buka sesi casino\n`!join casino` - Gabung casino\n`!main casino <taruhan>` - Main slot casino bersama' },
        { name: '🐓 SABUNG AYAM', value: '`!ayam` - Beli ayam (20.000 BFL, level unik)\n`!ayamku` - Lihat koleksimu\n`!tokoayam` - Lihat ayam dijual\n`!jualayam <kode> <harga>` - Jual ayammu\n`!beliayamtoko <kode>` - Beli ayam di toko\n`!sabung @user <kode_ayamku> <taruhan>` - Tantang!' },
        { name: '💼 KERJA', value: '`!kerja kuli` - Kuli (60.000 BFL, 10 menit)\n`!kerja pizza` - Antar Pizza (60.000 BFL, 10 menit)\n`!cekkerja` / `!ambilgaji`' },
        { name: '👑 VIP DEWA KERA', value: '`!beli vip` - 1.000.000 BFL\n✅ WR semua game +20% | Pajak hanya 5%' },
        { name: '📤 TOPUP IDR (DM Bot)', value: '`!topup <jumlah>` - Min Rp' + MIN_TOPUP.toLocaleString('id-ID') },
        { name: '📥 TARIK IDR (DM Bot)', value: '`!tarik <jumlah> <no_dana>`\nMin Rp' + MIN_TARIK.toLocaleString('id-ID') },
        { name: '⚠️ INFO PAJAK', value: 'Non-VIP: pajak **20%** untuk penghasilan > 20.000 BFL\nVIP: pajak hanya **5%**' },
        { name: '❤️ DONASI', value: DONATE_LINK }
      );
    return message.reply({ embeds: [embed] });
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

    if (!isDM) return message.reply('Registrasi hanya bisa di DM bot ini!');
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
    const vipStatus = user.isVIP ? '👑 VIP Dewa Kera Aktif (Pajak 5%, WR +20%)' : 'Tidak aktif';
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
      const foodConfig = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: 'Bekal untuk beraktivitas' };
      if (user.hunger >= 100) return message.reply('❤️ Nyawa sudah penuh (100%)!');
      if (user.balance < foodConfig.price) return message.reply('❌ Saldo tidak cukup! Harga: ' + foodConfig.price.toLocaleString('id-ID') + ' BFL');
      user.balance -= foodConfig.price;
      user.hunger   = 100;
      sendToAdmin(db, foodConfig.price);
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('🍱 ' + foodConfig.name + ' Dibeli!')
        .setColor(C_GREEN)
        .addFields(
          { name: 'Harga', value: foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '❤️ Nyawa', value: hungerBar(100), inline: false }
        );
      return message.reply({ embeds: [embed] });
    }

    // --- Beli VIP (#6: harga 1.000.000 BFL, WR +20%, pajak 5%) ---
    if (subCmd === 'vip') {
      if (!isDM) return message.reply('❌ Beli VIP hanya bisa di DM bot!');
      if (!user) return message.reply('Belum terdaftar!');
      ensureUserFields(user);
      if (user.isVIP) return message.reply('Kamu sudah VIP Dewa Kera!');
      if (user.balance < VIP_PRICE) return message.reply('Saldo tidak cukup! VIP Dewa Kera membutuhkan **' + VIP_PRICE.toLocaleString('id-ID') + ' BFL**.');
      user.balance -= VIP_PRICE;
      user.isVIP = true;
      sendToAdmin(db, VIP_PRICE);
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('👑 VIP Dewa Kera Aktif!')
        .setColor(C_PURPLE)
        .setDescription('Selamat! Kamu sekarang adalah **VIP Dewa Kera**!')
        .addFields(
          { name: 'Keuntungan', value: '✅ Win Rate semua game **+20%**\n✅ Pajak hanya **5%** (non-VIP 20%)' }
        );
      return message.reply({ embeds: [embed] });
    }

    return message.reply('Format: `!beli makan` atau `!beli vip`');
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
    const embed = new EmbedBuilder()
      .setTitle('Tip Berhasil! 🎁')
      .setColor(C_GREEN)
      .setDescription(message.author.username + ' mengirim **' + amount.toLocaleString('id-ID') + ' BFL** ke ' + target.username + '!')
      .addFields({ name: '❤️ Nyawa Kamu', value: hungerBar(user.hunger) });
    return message.reply({ embeds: [embed] });
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
    const embed = new EmbedBuilder()
      .setTitle('RAIN BFL Coin! 🌧️')
      .setColor(C_GOLD)
      .setDescription(message.author.username + ' membagikan hujan koin!\n\n' + mentions + '\n\nMasing-masing mendapat **' + perPerson.toLocaleString('id-ID') + ' BFL**!');
    return message.reply({ embeds: [embed] });
  }

  // ======================== !dadu ========================
  if (command === 'dadu') {
    if (isDM) return message.reply('Command !dadu hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
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
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    ensureUserFields(user);
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
      if (currency === 'IDR') { challenger.balanceIDR = (challenger.balanceIDR || 0) + bet; user.balanceIDR = (user.balanceIDR || 0) - bet; }
      else { challenger.balance += bet; user.balance -= bet; taxAmount = applyTax(db, challenger, bet); }
      resultText = '<@' + pending.challengerId + '> **MENANG** ' + bet.toLocaleString('id-ID') + ' ' + currency + '!' + (taxAmount > 0 ? '\n💸 Pajak: -' + taxAmount.toLocaleString('id-ID') : '');
    } else if (diceB > diceA) {
      if (currency === 'IDR') { user.balanceIDR = (user.balanceIDR || 0) + bet; challenger.balanceIDR = (challenger.balanceIDR || 0) - bet; }
      else { user.balance += bet; challenger.balance -= bet; taxAmount = applyTax(db, user, bet); }
      resultText = '<@' + message.author.id + '> **MENANG** ' + bet.toLocaleString('id-ID') + ' ' + currency + '!' + (taxAmount > 0 ? '\n💸 Pajak: -' + taxAmount.toLocaleString('id-ID') : '');
    } else {
      // #7: Seri — uang kembali ke masing-masing (tidak masuk kas bot)
      resultText = '**SERI!** 🤝 Taruhan dikembalikan ke masing-masing pemain.';
      // Tidak ada perubahan saldo karena kembali ke pemilik masing-masing
    }

    consumeHunger(user, 'dadu');
    consumeHunger(challenger, 'dadu');
    delete db.daduPending[message.author.id];
    db.transactions.push({ type: 'dadu', currency, playerA: pending.challengerId, playerB: message.author.id, bet, diceA, diceB, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Adu Dadu! 🎲')
      .setColor(C_GOLD)
      .setDescription(resultText)
      .addFields(
        { name: '<@' + pending.challengerId + '>', value: '🎲 ' + diceA, inline: true },
        { name: 'VS', value: '---', inline: true },
        { name: '<@' + message.author.id + '>', value: '🎲 ' + diceB, inline: true }
      );
    return message.reply({ embeds: [embed] });
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
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!slot <taruhan>`');
    if (user.balance < bet) return message.reply('Saldo BFL tidak cukup!');

    // #6: VIP WR +20%, base WR 50:50
    const winChance = user.isVIP ? 0.70 : 0.50;
    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    let multiplier = 0;
    if (Math.random() < winChance) {
      if (spin[0] === spin[1] && spin[1] === spin[2]) {
        if (spin[0] === '💎') multiplier = 10;
        else if (spin[0] === '7️⃣') multiplier = 7;
        else if (spin[0] === '⭐') multiplier = 5;
        else multiplier = 3;
      } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
        multiplier = 2;
      } else {
        multiplier = 1.5;
      }
    }

    const won    = Math.floor(bet * multiplier);
    const profit = won - bet;
    user.balance += profit;
    if (user.balance < 0) user.balance = 0;
    if (profit < 0) sendToAdmin(db, Math.abs(profit));
    let taxAmount = 0;
    if (profit > 0) taxAmount = applyTax(db, user, profit);
    consumeHunger(user, 'slot');
    saveDB(db);

    const line = '[ ' + spin.join(' | ') + ' ]';
    const hasilText = multiplier > 0
      ? 'MENANG +' + won.toLocaleString('id-ID') + ' BFL (x' + multiplier + ')' + (taxAmount > 0 ? '\n💸 Pajak: -' + taxAmount.toLocaleString('id-ID') + ' BFL' : '')
      : 'Kalah -' + bet.toLocaleString('id-ID') + ' BFL';

    const embed = new EmbedBuilder()
      .setTitle('SLOT MACHINE 🎰' + (user.isVIP ? ' 👑VIP' : ''))
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription(line)
      .addFields(
        { name: 'Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Hasil', value: hasilText, inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !slotidr (#1, #12: Slot IDR WR 30:70) ========================
  if (command === 'slotidr') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    ensureUserFields(user);

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!slotidr <taruhan>`');
    if ((user.balanceIDR || 0) < bet) return message.reply('Saldo IDR tidak cukup!\nSaldo IDR kamu: Rp ' + (user.balanceIDR || 0).toLocaleString('id-ID'));

    // #12: WR 30:70, VIP +20% = 50:50
    const winChance = user.isVIP ? 0.50 : 0.30;
    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];

    let multiplier = 0;
    if (Math.random() < winChance) {
      if (spin[0] === spin[1] && spin[1] === spin[2]) {
        if (spin[0] === '💎') multiplier = 10;
        else if (spin[0] === '7️⃣') multiplier = 7;
        else if (spin[0] === '⭐') multiplier = 5;
        else multiplier = 3;
      } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
        multiplier = 2;
      } else {
        multiplier = 1.5;
      }
    }

    const won    = Math.floor(bet * multiplier);
    const profit = won - bet;
    user.balanceIDR = (user.balanceIDR || 0) + profit;
    if (user.balanceIDR < 0) user.balanceIDR = 0;
    consumeHunger(user, 'slot');
    saveDB(db);

    const line = '[ ' + spin.join(' | ') + ' ]';
    const hasilText = multiplier > 0
      ? 'MENANG +Rp ' + won.toLocaleString('id-ID') + ' IDR (x' + multiplier + ')'
      : 'Kalah -Rp ' + bet.toLocaleString('id-ID') + ' IDR';

    const embed = new EmbedBuilder()
      .setTitle('SLOT IDR 🎰💵' + (user.isVIP ? ' 👑VIP' : ''))
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription(line + '\n\n⚠️ WR 30:70 (IDR Mode)' + (user.isVIP ? ' | VIP: WR 50:50' : ''))
      .addFields(
        { name: 'Taruhan', value: 'Rp ' + bet.toLocaleString('id-ID') + ' IDR', inline: true },
        { name: 'Hasil', value: hasilText, inline: true },
        { name: 'Saldo IDR', value: 'Rp ' + user.balanceIDR.toLocaleString('id-ID'), inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !bonanza (#11: Bonanza Slot) ========================
  if (command === 'bonanza') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    ensureUserFields(user);

    // Beli fitur bonanza
    if (args[0]?.toLowerCase() === 'beli') {
      const bonanzaFeatureCost = 100000;
      if (user.balance < bonanzaFeatureCost) return message.reply('Saldo tidak cukup! Harga fitur Bonanza: **100.000 BFL**');
      user.balance -= bonanzaFeatureCost;
      user.hasBonanza = true;
      sendToAdmin(db, bonanzaFeatureCost);
      saveDB(db);
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🎰 Fitur Bonanza Slot Dibeli!')
          .setColor(C_GOLD)
          .setDescription('Kamu sekarang bisa main **!bonanza <taruhan>** dengan hadiah mega jackpot!')
          .addFields({ name: 'Keuntungan', value: '🎲 6x6 grid symbols\n⚡ Tumbling reels\n💥 Multiplier meningkat tiap cascade\n🎁 Bonus spins!' })
      ]});
    }

    if (!user.hasBonanza) return message.reply('❌ Kamu belum membeli fitur Bonanza!\nBeli dengan `!bonanza beli` — harga **100.000 BFL**');

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!bonanza <taruhan>`\nAtau `!bonanza beli` untuk membeli fitur');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    // Bonanza mechanics: cascading wins
    const bonanzaSymbols = ['💎', '🔴', '🟢', '🔵', '🟡', '🟣', '⭐', '🎰'];
    const grid = [];
    for (let i = 0; i < 6; i++) {
      grid.push(bonanzaSymbols[Math.floor(Math.random() * bonanzaSymbols.length)]);
    }

    // Hitung matches
    const counts = {};
    grid.forEach(s => counts[s] = (counts[s] || 0) + 1);
    let totalMultiplier = 0;
    let cascades = 0;
    let winDetails = [];

    for (const [sym, count] of Object.entries(counts)) {
      if (count >= 3) {
        const baseMulti = count === 3 ? 1 : count === 4 ? 2 : count === 5 ? 4 : 8;
        const symMulti = sym === '💎' ? 3 : sym === '⭐' ? 2 : 1;
        totalMultiplier += baseMulti * symMulti;
        cascades++;
        winDetails.push(sym + ' x' + count + ' = x' + (baseMulti * symMulti));
      }
    }

    // VIP bonus
    if (user.isVIP) totalMultiplier = Math.floor(totalMultiplier * 1.2);

    const won    = Math.floor(bet * totalMultiplier);
    const profit = won - bet;
    user.balance += profit;
    if (user.balance < 0) user.balance = 0;
    if (profit < 0) sendToAdmin(db, Math.abs(profit));
    let taxBonanza = 0;
    if (profit > 0) taxBonanza = applyTax(db, user, profit);
    consumeHunger(user, 'slot');
    saveDB(db);

    const gridDisplay = grid.join(' ');
    const embed = new EmbedBuilder()
      .setTitle('🎰 BONANZA SLOT!')
      .setColor(totalMultiplier > 0 ? C_GOLD : C_RED)
      .setDescription('**[ ' + gridDisplay + ' ]**\n' + (cascades > 0 ? '✨ ' + cascades + ' Cascade Win!' : '😞 Tidak ada kombinasi'))
      .addFields(
        { name: 'Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Multiplier', value: totalMultiplier > 0 ? 'x' + totalMultiplier : 'x0', inline: true },
        { name: 'Hasil', value: totalMultiplier > 0 ? '+' + won.toLocaleString('id-ID') + ' BFL' + (taxBonanza > 0 ? '\n💸 Pajak: -' + taxBonanza.toLocaleString('id-ID') : '') : '-' + bet.toLocaleString('id-ID') + ' BFL', inline: false }
      );
    if (winDetails.length > 0) embed.addFields({ name: '🏆 Kombinasi Menang', value: winDetails.join('\n') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !mancing ========================
  if (command === 'mancing') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 500;
    if (user.balance < cost) return message.reply('Saldo BFL tidak cukup! Biaya mancing: **500 BFL**');

    // #4: WR 50:50
    const isWin = Math.random() < (user.isVIP ? 0.70 : 0.50);
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
    consumeHunger(user, 'mancing');
    saveDB(db);

    const actionMsg = randomFrom(FISH_MESSAGES);
    const embed = new EmbedBuilder()
      .setTitle('🎣 Hasil Memancing')
      .setColor(fish.price >= 1000 ? C_GOLD : C_BLUE)
      .setDescription(actionMsg + '\n\nKamu mendapat **' + fish.name + '**!')
      .addFields(
        { name: 'Harga Jual', value: fish.price > 0 ? fish.price.toLocaleString('id-ID') + ' BFL' : 'Tidak berharga', inline: true },
        { name: 'Biaya', value: cost.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !mancingidr (#12) ========================
  if (command === 'mancingidr') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    ensureUserFields(user);

    const cost = 500; // 500 IDR
    if ((user.balanceIDR || 0) < cost) return message.reply('Saldo IDR tidak cukup! Biaya mancing IDR: **Rp 500**');

    // #12: WR 35:65
    const isWin = Math.random() < (user.isVIP ? 0.55 : 0.35);
    user.balanceIDR -= cost;

    let fish;
    if (isWin) {
      fish = weightedRandom(FISH_TABLE_IDR.filter(f => f.price > 0));
    } else {
      fish = FISH_TABLE_IDR[0];
    }

    user.balanceIDR += fish.price;
    consumeHunger(user, 'mancing');
    saveDB(db);

    const actionMsg = randomFrom(FISH_MESSAGES);
    const profit = fish.price - cost;
    const embed = new EmbedBuilder()
      .setTitle('🎣 Hasil Memancing IDR')
      .setColor(fish.price > cost ? C_GOLD : C_RED)
      .setDescription(actionMsg + '\n\nKamu mendapat **' + fish.name + '**!')
      .addFields(
        { name: 'Nilai', value: fish.price > 0 ? 'Rp ' + fish.price.toLocaleString('id-ID') + ' IDR' : 'Tidak berharga', inline: true },
        { name: 'Biaya', value: 'Rp ' + cost.toLocaleString('id-ID') + ' IDR', inline: true },
        { name: 'Hasil', value: profit >= 0 ? '+Rp ' + profit.toLocaleString('id-ID') : '-Rp ' + Math.abs(profit).toLocaleString('id-ID'), inline: true },
        { name: 'Saldo IDR', value: 'Rp ' + user.balanceIDR.toLocaleString('id-ID'), inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !tambang ========================
  if (command === 'tambang') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

    const cost = 200;
    if (user.balance < cost) return message.reply('Saldo tidak cukup! Biaya tambang: **200 BFL**');

    // #4: WR 50:50
    const isWin = Math.random() < (user.isVIP ? 0.70 : 0.50);
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
          .setTitle('⛏️ Hasil Menambang')
          .setColor(C_RED)
          .setDescription(actionMsg + '\n\n😤 Kamu menemukan **Sampah**! Rugi 100 BFL tambahan.')
          .addFields({ name: '❤️ Nyawa', value: hungerBar(user.hunger) })
      ]});
    }

    const inv = getInventory(db, message.author.id);
    inv.push({ type: 'tambang', name: material.name, price: material.price, time: new Date().toISOString() });
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('⛏️ Hasil Menambang')
        .setColor(material.price >= 1000 ? C_GOLD : C_BLUE)
        .setDescription(actionMsg + '\n\nKamu menemukan **' + material.name + '**!')
        .addFields(
          { name: 'Harga Jual', value: material.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: 'Biaya', value: cost.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false }
        )
    ]});
  }

  // ======================== !tambangidr (#12) ========================
  if (command === 'tambangidr') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');
    ensureUserFields(user);

    const cost = 200;
    if ((user.balanceIDR || 0) < cost) return message.reply('Saldo IDR tidak cukup! Biaya tambang IDR: **Rp 200**');

    // #12: WR 35:65
    const isWin = Math.random() < (user.isVIP ? 0.55 : 0.35);
    user.balanceIDR -= cost;

    const actionMsg = randomFrom(MINE_MESSAGES);
    consumeHunger(user, 'tambang');

    let material;
    if (isWin) {
      material = weightedRandom(MINE_TABLE_IDR.filter(m => m.price > 0));
    } else {
      material = MINE_TABLE_IDR[0];
    }

    user.balanceIDR += material.price;
    if (user.balanceIDR < 0) user.balanceIDR = 0;
    saveDB(db);

    const profit = material.price - cost;
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('⛏️ Hasil Menambang IDR')
        .setColor(material.price > cost ? C_GOLD : C_RED)
        .setDescription(actionMsg + '\n\nKamu menemukan **' + material.name + '**!')
        .addFields(
          { name: 'Nilai', value: 'Rp ' + material.price.toLocaleString('id-ID') + ' IDR', inline: true },
          { name: 'Biaya', value: 'Rp ' + cost.toLocaleString('id-ID') + ' IDR', inline: true },
          { name: 'Hasil', value: profit >= 0 ? '+Rp ' + profit.toLocaleString('id-ID') : '-Rp ' + Math.abs(profit).toLocaleString('id-ID'), inline: true },
          { name: 'Saldo IDR', value: 'Rp ' + user.balanceIDR.toLocaleString('id-ID'), inline: false }
        )
    ]});
  }

  // ======================== !jual ========================
  if (command === 'jual') {
    if (!user) return message.reply('Belum terdaftar!');
    const type = args[0]?.toLowerCase();
    if (!type || !['ikan', 'tambang'].includes(type)) return message.reply('Format: `!jual ikan` atau `!jual tambang`');

    const inv    = getInventory(db, message.author.id);
    const toSell = inv.filter(i => i.type === (type === 'ikan' ? 'ikan' : 'tambang'));
    if (toSell.length === 0) return message.reply('Inventori ' + type + ' kamu kosong!');

    const total = toSell.reduce((sum, i) => sum + i.price, 0);
    db.inventory[message.author.id] = inv.filter(i => i.type !== type);

    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (adminUser) { adminUser.balance -= total; if (adminUser.balance < 0) adminUser.balance = 0; }
    user.balance += total;
    const taxJual = applyTax(db, user, total);
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('💰 Jual ' + (type === 'ikan' ? 'Ikan' : 'Material Tambang') + ' Berhasil!')
      .setColor(C_GREEN)
      .addFields(
        { name: 'Jumlah Item', value: toSell.length + ' item', inline: true },
        { name: 'Total Didapat', value: total.toLocaleString('id-ID') + ' BFL', inline: true }
      );
    if (taxJual > 0) embed.addFields({ name: '💸 Pajak', value: '-' + taxJual.toLocaleString('id-ID') + ' BFL', inline: true });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !inventori ========================
  if (command === 'inventori' || command === 'inventory') {
    if (!user) return message.reply('Belum terdaftar!');
    const inv = getInventory(db, message.author.id);
    if (inv.length === 0) return message.reply('Inventori kamu kosong! Coba `!mancing` atau `!tambang`.');
    const ikan    = inv.filter(i => i.type === 'ikan');
    const tambang = inv.filter(i => i.type === 'tambang');
    const embed = new EmbedBuilder()
      .setTitle('🎒 Inventori - ' + message.author.username)
      .setColor(C_BLUE)
      .addFields(
        { name: '🐟 Ikan (' + ikan.length + ')', value: (ikan.length ? ikan.map(i => i.name + ' (' + i.price + ' BFL)').join('\n').slice(0, 400) : 'Kosong') },
        { name: '⛏️ Material (' + tambang.length + ')', value: (tambang.length ? tambang.map(i => i.name + ' (' + i.price + ' BFL)').join('\n').slice(0, 400) : 'Kosong') }
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
    user.balance -= foodConfig.price;
    targetUser.hunger = 100;
    sendToAdmin(db, foodConfig.price);
    saveDB(db);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🍱 Memberi Makan!')
        .setColor(C_GREEN)
        .setDescription('**' + message.author.username + '** memberi makan kepada **' + target.username + '**!')
        .addFields({ name: '❤️ Nyawa ' + target.username, value: hungerBar(100) })
    ]});
  }

  // ======================== #5: !ayam (Beli Ayam - kode unik) ========================
  if (command === 'ayam' || command === 'beliayambaru') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.balance < AYAM_PRICE) return message.reply('Saldo tidak cukup! Harga ayam: **' + AYAM_PRICE.toLocaleString('id-ID') + ' BFL**');

    // Cari level yang tersedia (belum ada pemilik)
    const availableLevels = [];
    for (let lv = 1; lv <= 100; lv++) {
      const code = 'AYAM' + String(lv).padStart(3, '0');
      if (!db.ayamCodes[code]) availableLevels.push(lv);
    }

    if (availableLevels.length === 0) {
      return message.reply('❌ Semua ayam Lv.1-100 sudah dimiliki orang lain!\nCek toko ayam dengan `!tokoayam` untuk membeli dari pemain lain.');
    }

    // Random level dari yang tersedia
    const level = availableLevels[Math.floor(Math.random() * availableLevels.length)];
    const code  = 'AYAM' + String(level).padStart(3, '0');

    user.balance -= AYAM_PRICE;
    sendToAdmin(db, AYAM_PRICE);
    db.ayamCodes[code] = message.author.id;

    const ayam = { code, level, name: 'Ayam Lv.' + level, beli: new Date().toISOString() };
    user.chickens.push(ayam);
    saveDB(db);

    let tierText = level >= 80 ? '🔥 LEGENDA!' : level >= 60 ? '💪 Kuat!' : level >= 40 ? '😊 Lumayan' : level >= 20 ? '😐 Biasa' : '😢 Lemah';
    const embed = new EmbedBuilder()
      .setTitle('🐓 Ayam Baru Dibeli!')
      .setColor(level >= 80 ? C_GOLD : level >= 50 ? C_ORANGE : C_BLUE)
      .setDescription('Kamu mendapat **Ayam Lv.' + level + '** ' + tierText)
      .addFields(
        { name: 'Kode Unik', value: '`' + code + '`', inline: true },
        { name: 'Level', value: String(level) + '/100', inline: true },
        { name: 'Cara Sabung', value: '`!sabung @user ' + code + ' <taruhan>`\nLihat ayammu: `!ayamku`' }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !ayamku ========================
  if (command === 'ayamku') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (user.chickens.length === 0) return message.reply('Kamu belum punya ayam! Beli dengan `!ayam` (harga ' + AYAM_PRICE.toLocaleString('id-ID') + ' BFL).');
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
        .setTitle('🐓 Ayam Dibeli dari Toko!')
        .setColor(C_BROWN)
        .setDescription('Kamu berhasil membeli **' + item.name + '** dari toko!')
        .addFields(
          { name: 'Kode', value: '`' + kode + '`', inline: true },
          { name: 'Level', value: String(item.level), inline: true },
          { name: 'Harga', value: item.price.toLocaleString('id-ID') + ' BFL', inline: true }
        )
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
    if (challenger.isVIP) winProbA = Math.min(0.95, winProbA + 0.20);
    if (user.isVIP) winProbA = Math.max(0.05, winProbA - 0.20);

    const rand = Math.random();
    let resultText = '';
    let taxSabung = 0;

    if (rand < winProbA) {
      challenger.balance += pending.bet;
      user.balance -= pending.bet;
      taxSabung = applyTax(db, challenger, pending.bet);
      resultText = '🏆 **' + (challenger.discordTag || 'Penantang') + '** MENANG dengan **' + challAyam.name + '** (Lv.' + lvA + ')!' + (taxSabung > 0 ? '\n💸 Pajak: -' + taxSabung.toLocaleString('id-ID') + ' BFL' : '');
    } else {
      user.balance += pending.bet;
      challenger.balance -= pending.bet;
      taxSabung = applyTax(db, user, pending.bet);
      resultText = '🏆 **' + message.author.username + '** MENANG dengan **' + myAyam.name + '** (Lv.' + lvB + ')!' + (taxSabung > 0 ? '\n💸 Pajak: -' + taxSabung.toLocaleString('id-ID') + ' BFL' : '');
    }

    delete db.sabungPending[message.author.id];
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🐓 Sabung Ayam - Hasil!')
        .setColor(C_BROWN)
        .setDescription(resultText)
        .addFields(
          { name: '🐓 ' + challAyam.name, value: 'Lv.' + lvA + ' (' + (challenger.discordTag || 'Penantang') + ')', inline: true },
          { name: 'VS', value: '---', inline: true },
          { name: '🐓 ' + myAyam.name, value: 'Lv.' + lvB + ' (' + message.author.username + ')', inline: true },
          { name: '💰 Taruhan', value: pending.bet.toLocaleString('id-ID') + ' BFL', inline: true }
        )
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

  // ======================== #9: PARTY CASINO ========================
  // !party casino — buka sesi
  if (command === 'party' && args[0]?.toLowerCase() === 'casino') {
    if (isDM) return message.reply('!party casino hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');

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

  // !main casino <taruhan>
  if (command === 'main' && args[0]?.toLowerCase() === 'casino') {
    if (isDM) return message.reply('!main casino hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');

    if (!db.partyCasino) return message.reply('Tidak ada sesi casino aktif!');
    if (!db.partyCasino.players.find(p => p.id === message.author.id)) return message.reply('Kamu belum bergabung! Ketik `!join casino` dulu.');

    const bet = parseInt(args[1]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!main casino <taruhan>`');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan!');

    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const results = [];

    for (const player of db.partyCasino.players) {
      const pUser = getUserByDiscordId(db, player.id);
      if (!pUser || pUser.balance < bet) { results.push({ ...player, spin: ['❓', '❓', '❓'], won: 0, skipped: true }); continue; }
      const spin = [
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
      ];
      let multiplier = 0;
      const winChance = pUser.isVIP ? 0.70 : 0.50;
      if (Math.random() < winChance) {
        if (spin[0] === spin[1] && spin[1] === spin[2]) {
          if (spin[0] === '💎') multiplier = 10;
          else if (spin[0] === '7️⃣') multiplier = 7;
          else if (spin[0] === '⭐') multiplier = 5;
          else multiplier = 3;
        } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
          multiplier = 2;
        } else {
          multiplier = 1.5;
        }
      }
      const won = Math.floor(bet * multiplier);
      const profit = won - bet;
      pUser.balance += profit;
      if (pUser.balance < 0) pUser.balance = 0;
      if (profit < 0) sendToAdmin(db, Math.abs(profit));
      let tax = 0;
      if (profit > 0) tax = applyTax(db, pUser, profit);
      consumeHunger(pUser, 'slot');
      results.push({ ...player, spin, won, multiplier, profit, tax });
    }

    saveDB(db);

    const resultLines = results.map(r => {
      if (r.skipped) return '<@' + r.id + '>: ⏭️ Dilewati (saldo tidak cukup)';
      const line = '[ ' + r.spin.join('|') + ' ]';
      const status = r.multiplier > 0 ? '✅ +' + r.won.toLocaleString('id-ID') + ' BFL' : '❌ -' + bet.toLocaleString('id-ID') + ' BFL';
      return '<@' + r.id + '>: ' + line + ' → ' + status;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🎮 Party Casino - Hasil!')
      .setColor(C_TEAL)
      .setDescription('Taruhan: **' + bet.toLocaleString('id-ID') + ' BFL** per orang\n\n' + resultLines)
      .addFields({ name: 'Main Lagi?', value: '`!main casino <taruhan>`\n`!party casino` untuk sesi baru' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !kupon (gacha harian) ========================
  if (command === 'kupon') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    const now = Date.now();
    const lastKupon = user.lastCoupon ? new Date(user.lastCoupon).getTime() : 0;
    const cooldown = 24 * 60 * 60 * 1000;

    if (now - lastKupon < cooldown) {
      const remaining = cooldown - (now - lastKupon);
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      return message.reply('⏳ Kupon harian sudah diklaim! Coba lagi dalam **' + h + ' jam ' + m + ' menit**.');
    }

    const gachaType = Math.random();
    let rewardDesc = '';

    if (gachaType < 0.40) {
      const uang = Math.floor(Math.random() * 30001) + 20000;
      user.balance += uang;
      const taxKupon = applyTax(db, user, uang);
      rewardDesc = '💰 **Uang ' + uang.toLocaleString('id-ID') + ' BFL**' + (taxKupon > 0 ? ' (pajak: -' + taxKupon.toLocaleString('id-ID') + ' BFL)' : '');
    } else {
      const inv = getInventory(db, message.author.id);
      const ikanRewards = [];
      for (let i = 0; i < 2; i++) {
        const ikan = weightedRandom(FISH_TABLE.filter(f => f.price > 0));
        inv.push({ type: 'ikan', name: ikan.name, price: ikan.price, time: new Date().toISOString() });
        ikanRewards.push(ikan.name);
      }
      const tambangRewards = [];
      for (let i = 0; i < 2; i++) {
        const mat = weightedRandom(MINE_TABLE.filter(m => m.price > 0));
        inv.push({ type: 'tambang', name: mat.name, price: mat.price, time: new Date().toISOString() });
        tambangRewards.push(mat.name);
      }
      user.hunger = Math.min(100, user.hunger + 50);
      rewardDesc = '🍱 **Paket Makan** (+50% nyawa)\n🐟 Ikan: ' + ikanRewards.join(', ') + '\n⛏️ Material: ' + tambangRewards.join(', ');
    }

    user.lastCoupon = new Date().toISOString();
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🎟️ Kupon Gacha Harian!')
        .setColor(C_PURPLE)
        .addFields(
          { name: '🎁 Hadiah', value: rewardDesc },
          { name: '❤️ Nyawa', value: hungerBar(user.hunger) }
        )
        .setFooter({ text: 'Klaim lagi kupon besok!' })
    ]});
  }

  // ======================== #2: !kerja (Gaji 60.000, timer 10 menit) ========================
  if (command === 'kerja') {
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);
    if (isStarving(user)) return message.reply('❌ Kamu kehabisan makan! Beli dulu dengan `!beli makan`');

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
    const jobList = 'Pilih pekerjaan:\n⛏️ **Kuli** — Gaji **60.000 BFL** | Timer 10 menit\n`!kerja kuli`\n\n🍕 **Antar Pizza** — Gaji **60.000 BFL** | Timer 10 menit\n`!kerja pizza`';

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
        .addFields(
          { name: '💰 Gaji', value: '60.000 BFL', inline: true },
          { name: '⏱️ Waktu', value: '10 menit', inline: true },
          { name: '⚠️ Perhatian', value: 'Ketik `!ambilgaji` setelah 10 menit untuk ambil gaji!' }
        )
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
        .setTitle('💰 Gaji Diterima!')
        .setColor(C_GREEN)
        .setDescription('Gaji **' + activeJob.emoji + ' ' + activeJob.name + '** sudah masuk!')
        .addFields(
          { name: '💵 Gaji', value: activeJob.gaji.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false }
        )
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
          '`!giveidr @user <jumlah>` — Beri IDR ke user\n' +
          '`!allusers` — Lihat semua user\n' +
          '`!top` — Leaderboard\n' +
          '`!addbalance <jumlah>` — Tambah saldo BFL admin'
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

  // !closecasino (admin)
  if (command === 'closecasino') {
    if (message.author.id !== ADMIN_ID) return;
    db.partyCasino = null;
    saveDB(db);
    return message.reply('✅ Sesi Party Casino ditutup oleh admin.');
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
        .addFields(
          { name: 'Jumlah', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
          { name: 'No DANA', value: noHp, inline: true },
          { name: 'Estimasi', value: 'Maksimal 1x24 jam' }
        )
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
          .setDescription('Rp' + amount.toLocaleString('id-ID') + ' IDR berhasil masuk!')
          .addFields({ name: 'Saldo IDR', value: 'Rp ' + targetUser.balanceIDR.toLocaleString('id-ID') })
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
    return message.reply('Berhasil memberi ' + amount.toLocaleString('id-ID') + ' BFL ke ' + target.username + '!');
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
    const list = Object.values(db.users)
      .map(u => (u.discordTag || u.noHp) + ': ' + u.balance.toLocaleString('id-ID') + ' BFL | IDR: ' + (u.balanceIDR || 0).toLocaleString('id-ID'))
      .join('\n');
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('Semua User BFL Coin')
        .setColor(C_BLUE)
        .setDescription((list || 'Belum ada user.').slice(0, 4000))
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
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
