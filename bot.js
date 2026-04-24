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

// ============================================================
// SISTEM MAKAN/MINUM (Nyawa)
// ============================================================
const DEFAULT_FOOD_PRICE = 500;

// Pengurangan nyawa per aktivitas (dalam %)
// Tambang paling berat, fishing medium, slot/dadu ringan
const HUNGER_RATES = {
  tambang: 6,
  mancing:  3,
  slot:     2,
  dadu:     2,
  rain:     1,
  tip:      1,
  default:  2,
};
// Setiap kelipatan 10 aktivitas = bonus -30% ekstra

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
      }
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

  if (!db.daduPending)  db.daduPending  = {};
  if (!db.inventory)    db.inventory    = {};
  if (!db.foodConfig)   db.foodConfig   = { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: 'Bekal untuk beraktivitas' };

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
        balance: existing ? existing.balance : 225000,
        registered: true,
        discordTag: 'Admin',
        registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
        isVIP: false,
        lastDailyBox: null,
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
  if (user.lastDailyBox === undefined)  user.lastDailyBox = null;
  if (user.hunger === undefined)        user.hunger = 100;
  if (user.activityCount === undefined) user.activityCount = 0;
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
  // Setiap 10 aktivitas, bonus -30%
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

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
// HELPER
// ============================================================
function isDMChannel(channel) { return !channel.guild; }

// ============================================================
// DATA ITEM MEMANCING & MENAMBANG
// Poin 8: Kesulitan ditingkatkan (item buruk lebih sering, item bagus lebih jarang)
// ============================================================
const FISH_TABLE = [
  { name: 'Ikan Busuk',     price: 0,    weight: 35 },
  { name: 'Ikan Kecil',     price: 200,  weight: 28 },
  { name: 'Ikan Mas',       price: 500,  weight: 18 },
  { name: 'Ikan Kerapu',    price: 1000, weight: 10 },
  { name: 'Ikan Tuna',      price: 2000, weight: 6  },
  { name: 'Ikan Hiu Kecil', price: 3500, weight: 2  },
  { name: 'Ikan Langka',    price: 5000, weight: 1  },
];

const MINE_TABLE = [
  // Poin 1: Metalscap -> Metalscrap (typo fix)
  { name: 'Sampah',     price: -100, weight: 40 },
  { name: 'Batu Biasa', price: 100,  weight: 25 },
  { name: 'Bottle',     price: 500,  weight: 18 },
  { name: 'Silver',     price: 600,  weight: 12 },
  { name: 'Metalscrap', price: 1000, weight: 5  },
];

// Variasi pesan (Poin 4)
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
        { name: '💰 CEK SALDO (DM Bot)', value: '`!saldo`' },
        { name: '👤 PROFIL (DM Bot)', value: '`!profile`' },
        { name: '❤️ CEK NYAWA', value: '`!nyawa` - Cek status makan & minum kamu' },
        { name: '🍱 BELI MAKAN', value: '`!beli makan` - Beli **' + foodName + '** seharga **' + foodPrice.toLocaleString('id-ID') + ' BFL**\n*(Wajib punya nyawa > 0% untuk beraktivitas!)*' },
        { name: '🎁 TIP', value: '`!tip @user <jumlah>`' },
        { name: '🌧️ RAIN / PARTY', value: '`!rain <jumlah>` - Bagikan ke yang aktif di channel' },
        { name: '🎲 DADU 1v1', value: '`!dadu @user <taruhan>` - Target harus acc/cancel dulu!' },
        { name: '🎰 SLOT', value: '`!slot <taruhan>` - Main slot mesin!' },
        { name: '🎣 MEMANCING', value: '`!mancing` - Bayar 500 BFL, dapat ikan!\n`!jual ikan` - Jual semua ikan\n`!inventori` - Lihat inventori' },
        { name: '⛏️ MENAMBANG', value: '`!tambang` - Bayar 200 BFL, dapat material!\n`!jual tambang` - Jual semua material\n`!inventori` - Lihat inventori' },
        { name: '📦 BOX HARIAN (DM Bot)', value: '`!box` - Klaim box hadiah setiap 24 jam (100-1000 BFL)' },
        { name: '👑 VIP DEWA KERA', value: '`!beli vip` - Beli VIP Dewa Kera seharga 5000 BFL\nBonus: Box Premium 3000-7000 BFL (30% chance)\nGunakan `!boxpremium` setelah VIP aktif' },
        { name: '📤 TOPUP (DM Bot)', value: '`!topup <jumlah>` - Min Rp' + MIN_TOPUP.toLocaleString('id-ID') },
        { name: '📥 TARIK / WD (DM Bot)', value: '`!tarik <jumlah> <no_dana>`\nContoh: `!tarik 10000 08123456789`\nMin Rp' + MIN_TARIK.toLocaleString('id-ID') },
        { name: '❤️ DONASI', value: DONATE_LINK }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !register ========================
  if (command === 'register') {
    if (!isDM) return message.reply('Registrasi hanya bisa di DM bot ini!');
    if (user) return message.reply('Kamu sudah terdaftar! Gunakan `!saldo` untuk cek saldo.');

    db.users['USER_' + message.author.id] = {
      discordId: message.author.id,
      discordTag: message.author.tag,
      noHp: null,
      balance: 1000,
      registered: true,
      registeredAt: new Date().toISOString(),
      isVIP: false,
      lastDailyBox: null,
      hunger: 100,
      activityCount: 0
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Registrasi Berhasil! 🎉')
      .setColor(C_GREEN)
      .setDescription('Selamat datang di BFL Coin, **' + message.author.username + '**!')
      .addFields(
        { name: 'Saldo Awal', value: '1.000 BFL 🎁 (Bonus registrasi!)', inline: true },
        { name: '❤️ Nyawa', value: '100% — Penuh!', inline: true },
        { name: 'Info Penting', value: 'Gunakan `!nyawa` untuk cek kondisi makan/minum.\nJika nyawa 0%, kamu tidak bisa beraktivitas!\nBeli makan dengan `!beli makan`.' }
      );
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
      .setDescription(user.balance.toLocaleString('id-ID') + ' BFL\n= Rp' + user.balance.toLocaleString('id-ID'))
      .addFields({ name: '❤️ Nyawa', value: hungerBar(user.hunger) })
      .setFooter({ text: 'Min tarik: Rp' + MIN_TARIK.toLocaleString('id-ID') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !nyawa ========================
  if (command === 'nyawa') {
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);

    const foodConfig = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum' };
    let status = '';
    if (user.hunger <= 0) {
      status = '💀 **MATI KELAPARAN!** Kamu tidak bisa beraktivitas apapun!\nSegera beli makan dengan `!beli makan`!';
    } else if (user.hunger <= 20) {
      status = '😰 **Sangat Lapar!** Segera beli makan sebelum tidak bisa beraktivitas!';
    } else if (user.hunger <= 50) {
      status = '😟 **Mulai Lapar.** Pertimbangkan membeli makan segera.';
    } else if (user.hunger <= 80) {
      status = '😊 **Cukup Kenyang.** Masih bisa beraktivitas dengan nyaman.';
    } else {
      status = '😄 **Kenyang!** Kamu dalam kondisi prima!';
    }

    const embed = new EmbedBuilder()
      .setTitle('❤️ Status Nyawa - ' + message.author.username)
      .setColor(user.hunger <= 0 ? C_RED : user.hunger <= 50 ? C_ORANGE : C_GREEN)
      .addFields(
        { name: 'Kondisi Makan & Minum', value: hungerBar(user.hunger), inline: false },
        { name: 'Status', value: status, inline: false },
        { name: 'Total Aktivitas Dilakukan', value: (user.activityCount || 0).toString() + ' kali', inline: true },
        { name: 'Harga Beli Makan', value: foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Cara Isi Nyawa', value: 'Ketik `!beli makan` untuk membeli **' + foodConfig.name + '**', inline: false },
        { name: 'Info Pengurangan Nyawa', value: '⛏️ Tambang: -6%/aktivitas (paling berat)\n🎣 Mancing: -3%/aktivitas\n🎰 Slot/🎲 Dadu: -2%/aktivitas\n🌧️ Rain/Tip: -1%/aktivitas\n📌 Setiap 10 aktivitas: bonus -30% ekstra', inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !profile ========================
  if (command === 'profile') {
    if (!isDM) return message.reply('❌ Command !profile hanya bisa digunakan di DM bot!');
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');
    ensureUserFields(user);
    const txCount   = db.transactions.filter(t => t.from === message.author.id || t.to === message.author.id).length;
    const vipStatus = user.isVIP ? '👑 VIP Dewa Kera Aktif' : 'Tidak aktif';
    const noHpDisplay = user.noHp ? user.noHp : '*(Belum diset — diperlukan saat WD)*';
    const embed = new EmbedBuilder()
      .setTitle('Profil - ' + message.author.username)
      .setColor(C_BLUE)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: 'No DANA', value: noHpDisplay, inline: true },
        { name: 'Saldo', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false },
        { name: 'Total Transaksi', value: String(txCount), inline: true },
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

      if (user.hunger >= 100) {
        return message.reply('❤️ Nyawa kamu sudah penuh **(100%)**! Tidak perlu beli makan.');
      }
      if (user.balance < foodConfig.price) {
        return message.reply(
          '❌ Saldo tidak cukup!\n' +
          'Harga **' + foodConfig.name + '**: ' + foodConfig.price.toLocaleString('id-ID') + ' BFL\n' +
          'Saldo kamu: **' + user.balance.toLocaleString('id-ID') + ' BFL**'
        );
      }

      user.balance -= foodConfig.price;
      user.hunger   = 100;
      sendToAdmin(db, foodConfig.price); // Pembayaran makan masuk ke admin
      saveDB(db);

      const embed = new EmbedBuilder()
        .setTitle('🍱 ' + foodConfig.name + ' Dibeli!')
        .setColor(C_GREEN)
        .setDescription(foodConfig.description || 'Kamu sudah makan dan minum dengan kenyang!')
        .addFields(
          { name: 'Harga', value: foodConfig.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: '❤️ Nyawa Sekarang', value: hungerBar(100), inline: false },
          { name: 'Saldo Tersisa', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true }
        );
      return message.reply({ embeds: [embed] });
    }

    // --- Beli VIP ---
    if (subCmd === 'vip') {
      if (!isDM) return message.reply('❌ Beli VIP hanya bisa di DM bot!');
      if (!user) return message.reply('Belum terdaftar!');
      ensureUserFields(user);

      if (user.isVIP) return message.reply('Kamu sudah VIP Dewa Kera! Gunakan `!boxpremium` untuk klaim box premium.');
      const vipCost = 5000;
      if (user.balance < vipCost) return message.reply('Saldo tidak cukup! VIP Dewa Kera membutuhkan **5.000 BFL**.');

      user.balance -= vipCost;
      user.isVIP = true;
      sendToAdmin(db, vipCost);
      saveDB(db);

      const embed = new EmbedBuilder()
        .setTitle('👑 VIP Dewa Kera Aktif!')
        .setColor(C_PURPLE)
        .setDescription('Selamat! Kamu sekarang adalah **VIP Dewa Kera**!')
        .addFields(
          { name: 'Keuntungan', value: 'Akses ke `!boxpremium` dengan hadiah **3.000-7.000 BFL**\nWin Rate 30%, kalah 70% (tidak dapat apa-apa)' },
          { name: 'Cara Pakai', value: 'Ketik `!boxpremium` di DM bot ini' }
        );
      return message.reply({ embeds: [embed] });
    }

    return message.reply('Format: `!beli makan` atau `!beli vip`');
  }

  // ======================== !tip ========================
  if (command === 'tip') {
    if (isDM) return message.reply('Command !tip hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar! DM bot dan ketik `!register`');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa beraktivitas!');

    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('Format: `!tip @user <jumlah>`');
    if (target.id === message.author.id) return message.reply('Tidak bisa tip ke diri sendiri!');
    if (target.bot) return message.reply('Tidak bisa tip ke bot!');
    if (user.balance < amount) return message.reply('Saldo tidak cukup!');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar di BFL Coin!');

    user.balance -= amount;
    targetUser.balance += amount;
    consumeHunger(user, 'tip');
    db.transactions.push({ type: 'tip', from: message.author.id, to: target.id, amount, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Tip Berhasil! 🎁')
      .setColor(C_GREEN)
      .setDescription(message.author.username + ' mengirim **' + amount.toLocaleString('id-ID') + ' BFL** ke ' + target.username + '!')
      .setFooter({ text: '❤️ Nyawa kamu: ' + user.hunger + '%' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !rain / !party ========================
  if (command === 'rain' || command === 'party') {
    if (isDM) return message.reply('Command !rain hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa beraktivitas!');

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
    if (eligible.length === 0) return message.reply('Tidak ada user aktif yang terdaftar di channel ini!');

    const perPerson = Math.floor(amount / eligible.length);
    if (perPerson < 1) return message.reply('Jumlah terlalu kecil untuk dibagi ' + eligible.length + ' orang!');

    user.balance -= perPerson * eligible.length;
    eligible.forEach(a => {
      const u = getUserByDiscordId(db, a.id);
      u.balance += perPerson;
    });
    consumeHunger(user, 'rain');
    db.transactions.push({ type: 'rain', from: message.author.id, amount, recipients: eligible.length, timestamp: new Date().toISOString() });
    saveDB(db);

    const mentions = eligible.map(a => '<@' + a.id + '>').join(' ');
    const embed = new EmbedBuilder()
      .setTitle('RAIN / PARTY BFL Coin! 🌧️')
      .setColor(C_GOLD)
      .setDescription(message.author.username + ' membagikan hujan koin!\n\n' + mentions + '\n\nMasing-masing mendapat **' + perPerson.toLocaleString('id-ID') + ' BFL**!')
      .addFields({ name: 'Total Dibagikan', value: (perPerson * eligible.length).toLocaleString('id-ID') + ' BFL ke ' + eligible.length + ' orang' })
      .setFooter({ text: '❤️ Nyawa kamu: ' + user.hunger + '%' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !dadu ========================
  if (command === 'dadu') {
    if (isDM) return message.reply('Command !dadu hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa beraktivitas!');

    const target = message.mentions.users.first();
    const bet    = parseInt(args[1]);
    if (!target || isNaN(bet) || bet <= 0) return message.reply('Format: `!dadu @user <taruhan>`');
    if (target.bot || target.id === message.author.id) return message.reply('Target tidak valid!');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    if (targetUser.balance < bet) return message.reply(target.username + ' tidak punya saldo cukup!');

    if (db.daduPending[target.id]) return message.reply(target.username + ' masih punya tantangan dadu yang belum dijawab!');

    db.daduPending[target.id] = {
      challengerId: message.author.id,
      challengerTag: message.author.tag,
      bet,
      channelId: message.channel.id,
      timestamp: Date.now()
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Tantangan Dadu! 🎲')
      .setColor(C_ORANGE)
      .setDescription('<@' + target.id + '>! **' + message.author.username + '** mengajakmu adu dadu!\n\nTaruhan: **' + bet.toLocaleString('id-ID') + ' BFL**')
      .addFields({ name: 'Jawab dengan', value: '`!acc` untuk terima\n`!cancel` untuk tolak' })
      .setFooter({ text: 'Tantangan akan expired dalam 2 menit' });
    await message.reply({ embeds: [embed] });

    setTimeout(() => {
      const dbNow = loadDB();
      if (dbNow.daduPending[target.id] && dbNow.daduPending[target.id].challengerId === message.author.id) {
        delete dbNow.daduPending[target.id];
        saveDB(dbNow);
        message.channel.send('<@' + target.id + '> Tantangan dadu dari **' + message.author.username + '** sudah expired!').catch(() => {});
      }
    }, 2 * 60 * 1000);
    return;
  }

  // ======================== !acc ========================
  if (command === 'acc') {
    if (isDM) return message.reply('Command !acc hanya bisa di server!');
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa beraktivitas!');

    const pending = db.daduPending[message.author.id];
    if (!pending) return message.reply('Kamu tidak punya tantangan dadu yang menunggu!');

    const challenger = getUserByDiscordId(db, pending.challengerId);
    if (!challenger) {
      delete db.daduPending[message.author.id];
      saveDB(db);
      return message.reply('Penantang tidak ditemukan!');
    }

    const bet = pending.bet;
    if (challenger.balance < bet) {
      delete db.daduPending[message.author.id];
      saveDB(db);
      return message.reply('Saldo penantang tidak cukup lagi. Tantangan dibatalkan.');
    }
    if (user.balance < bet) {
      delete db.daduPending[message.author.id];
      saveDB(db);
      return message.reply('Saldo kamu tidak cukup untuk menerima tantangan ini!');
    }

    const diceA = Math.floor(Math.random() * 6) + 1;
    const diceB = Math.floor(Math.random() * 6) + 1;
    let resultText = '';
    let winnerId   = null;

    if (diceA > diceB) {
      challenger.balance += bet;
      user.balance -= bet;
      winnerId = pending.challengerId;
      resultText = '<@' + pending.challengerId + '> **MENANG** ' + bet.toLocaleString('id-ID') + ' BFL!';
    } else if (diceB > diceA) {
      user.balance += bet;
      challenger.balance -= bet;
      winnerId = message.author.id;
      resultText = '<@' + message.author.id + '> **MENANG** ' + bet.toLocaleString('id-ID') + ' BFL!';
    } else {
      challenger.balance -= bet;
      user.balance -= bet;
      sendToAdmin(db, bet * 2);
      resultText = '**SERI!** Taruhan masuk ke kas bot.';
    }

    consumeHunger(user, 'dadu');
    ensureUserFields(challenger);
    consumeHunger(challenger, 'dadu');

    delete db.daduPending[message.author.id];
    db.transactions.push({ type: 'dadu', playerA: pending.challengerId, playerB: message.author.id, bet, diceA, diceB, winner: winnerId, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Adu Dadu! 🎲')
      .setColor(C_GOLD)
      .setDescription(resultText)
      .addFields(
        { name: '<@' + pending.challengerId + '>', value: '🎲 ' + diceA, inline: true },
        { name: 'VS', value: '---', inline: true },
        { name: '<@' + message.author.id + '>', value: '🎲 ' + diceB, inline: true }
      )
      .setFooter({ text: '❤️ Nyawa kamu: ' + user.hunger + '%' });
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
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa beraktivitas!');

    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: `!slot <taruhan>`');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];
    const line = '[ ' + spin.join(' | ') + ' ]';

    let multiplier = 0;
    if (spin[0] === spin[1] && spin[1] === spin[2]) {
      if (spin[0] === '💎') multiplier = 10;
      else if (spin[0] === '7️⃣') multiplier = 7;
      else if (spin[0] === '⭐') multiplier = 5;
      else multiplier = 3;
    } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
      multiplier = 2;
    }

    const won    = Math.floor(bet * multiplier);
    const profit = won - bet;
    user.balance += profit;
    if (user.balance < 0) user.balance = 0;
    if (profit < 0) sendToAdmin(db, Math.abs(profit));

    consumeHunger(user, 'slot');
    saveDB(db);

    const hasilText = multiplier > 0
      ? 'MENANG +' + won.toLocaleString('id-ID') + ' BFL (x' + multiplier + ')'
      : 'Kalah -' + bet.toLocaleString('id-ID') + ' BFL';

    const embed = new EmbedBuilder()
      .setTitle('SLOT MACHINE 🎰')
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription(line)
      .addFields(
        { name: 'Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Hasil', value: hasilText, inline: true }
      )
      .setFooter({ text: '❤️ Nyawa kamu: ' + user.hunger + '%' + (user.hunger <= 20 ? ' ⚠️ Segera beli makan!' : '') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !mancing ========================
  if (command === 'mancing') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa memancing!');

    const cost = 500;
    if (user.balance < cost) return message.reply('Saldo tidak cukup! Biaya mancing: **500 BFL**');

    user.balance -= cost;
    sendToAdmin(db, cost);

    const fish = weightedRandom(FISH_TABLE);
    const inv  = getInventory(db, message.author.id);
    inv.push({ type: 'ikan', name: fish.name, price: fish.price, time: new Date().toISOString() });

    consumeHunger(user, 'mancing');
    saveDB(db);

    const actionMsg = randomFrom(FISH_MESSAGES);
    const embed = new EmbedBuilder()
      .setTitle('🎣 Hasil Memancing')
      .setColor(fish.price >= 1000 ? C_GOLD : C_BLUE)
      .setDescription(actionMsg + '\n\nKamu berhasil mendapat **' + fish.name + '**!')
      .addFields(
        { name: 'Harga Jual', value: fish.price > 0 ? fish.price.toLocaleString('id-ID') + ' BFL' : 'Tidak berharga', inline: true },
        { name: 'Biaya Mancing', value: cost.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false },
        { name: 'Cara Jual', value: 'Ketik `!jual ikan` untuk jual semua ikan' }
      )
      .setFooter({ text: 'Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL' + (user.hunger <= 20 ? ' | ⚠️ Segera beli makan!' : '') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !tambang ========================
  if (command === 'tambang') {
    if (!user) return message.reply('Belum terdaftar!');
    if (isStarving(user)) return message.reply('❌ **Kamu kehabisan makan & minum!**\nBeli makan dulu dengan `!beli makan` sebelum bisa menambang!');

    const cost = 200;
    if (user.balance < cost) return message.reply('Saldo tidak cukup! Biaya tambang: **200 BFL**');

    user.balance -= cost;
    sendToAdmin(db, cost);

    const material  = weightedRandom(MINE_TABLE);
    const inv       = getInventory(db, message.author.id);
    const actionMsg = randomFrom(MINE_MESSAGES);

    consumeHunger(user, 'tambang'); // paling banyak mengurangi nyawa

    if (material.price < 0) {
      user.balance += material.price;
      if (user.balance < 0) user.balance = 0;
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('⛏️ Hasil Menambang')
        .setColor(C_RED)
        .setDescription(actionMsg + '\n\n😤 Kamu menemukan **Sampah**! Rugi 100 BFL tambahan.')
        .addFields({ name: '❤️ Nyawa', value: hungerBar(user.hunger) })
        .setFooter({ text: 'Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL' + (user.hunger <= 20 ? ' | ⚠️ Segera beli makan!' : '') });
      return message.reply({ embeds: [embed] });
    }

    inv.push({ type: 'tambang', name: material.name, price: material.price, time: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('⛏️ Hasil Menambang')
      .setColor(material.price >= 1000 ? C_GOLD : C_BLUE)
      .setDescription(actionMsg + '\n\nKamu menemukan **' + material.name + '**!')
      .addFields(
        { name: 'Harga Jual', value: material.price.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Biaya Tambang', value: cost.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger), inline: false },
        { name: 'Cara Jual', value: 'Ketik `!jual tambang` untuk jual semua material' }
      )
      .setFooter({ text: 'Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL' + (user.hunger <= 20 ? ' | ⚠️ Segera beli makan!' : '') });
    return message.reply({ embeds: [embed] });
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
    db.inventory[message.author.id] = inv.filter(i => i.type !== (type === 'ikan' ? 'ikan' : 'tambang'));

    // Poin 7: Hasil jual diambil dari dana admin
    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (adminUser) {
      adminUser.balance -= total;
      if (adminUser.balance < 0) adminUser.balance = 0;
    }
    user.balance += total;
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('💰 Jual ' + (type === 'ikan' ? 'Ikan' : 'Material Tambang') + ' Berhasil!')
      .setColor(C_GREEN)
      .setDescription('Hasil penjualan langsung dari dana admin! 💸')
      .addFields(
        { name: 'Jumlah Item', value: toSell.length + ' item', inline: true },
        { name: 'Total Didapat', value: total.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Saldo Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !inventori ========================
  if (command === 'inventori' || command === 'inventory') {
    if (!user) return message.reply('Belum terdaftar!');
    const inv = getInventory(db, message.author.id);
    if (inv.length === 0) return message.reply('Inventori kamu kosong! Coba `!mancing` atau `!tambang`.');

    const ikan    = inv.filter(i => i.type === 'ikan');
    const tambang = inv.filter(i => i.type === 'tambang');

    const ikanList    = ikan.length    ? ikan.map(i => i.name + ' (' + i.price + ' BFL)').join('\n') : 'Kosong';
    const tambangList = tambang.length ? tambang.map(i => i.name + ' (' + i.price + ' BFL)').join('\n') : 'Kosong';

    const embed = new EmbedBuilder()
      .setTitle('🎒 Inventori - ' + message.author.username)
      .setColor(C_BLUE)
      .addFields(
        { name: '🐟 Ikan (' + ikan.length + ' item)', value: ikanList.slice(0, 400) },
        { name: '⛏️ Material (' + tambang.length + ' item)', value: tambangList.slice(0, 400) }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !box ========================
  if (command === 'box') {
    if (!isDM) return message.reply('❌ Command !box hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    const now      = Date.now();
    const last     = user.lastDailyBox ? new Date(user.lastDailyBox).getTime() : 0;
    const diff     = now - last;
    const cooldown = 24 * 60 * 60 * 1000;

    if (diff < cooldown) {
      const remaining = cooldown - diff;
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      return message.reply('⏳ Box harian sudah diklaim! Coba lagi dalam **' + h + ' jam ' + m + ' menit**.');
    }

    const reward = Math.floor(Math.random() * 901) + 100;
    user.balance += reward;
    user.lastDailyBox = new Date().toISOString();
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('📦 Box Harian Diklaim!')
      .setColor(C_GREEN)
      .setDescription('Kamu mendapat **' + reward.toLocaleString('id-ID') + ' BFL** dari Box Harian!')
      .addFields(
        { name: 'Saldo Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL' },
        { name: '❤️ Nyawa', value: hungerBar(user.hunger) }
      )
      .setFooter({ text: 'Kembali lagi besok untuk klaim box berikutnya!' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !boxpremium ========================
  if (command === 'boxpremium') {
    if (!isDM) return message.reply('❌ Command !boxpremium hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');
    ensureUserFields(user);

    if (!user.isVIP) return message.reply('❌ Fitur ini hanya untuk **VIP Dewa Kera**!\nBeli VIP dengan `!beli vip` seharga 5.000 BFL.');

    const isWin = Math.random() < 0.30;
    if (isWin) {
      const reward = Math.floor(Math.random() * 4001) + 3000;
      user.balance += reward;
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('📦 BOX PREMIUM - MENANG! 🎉')
        .setColor(C_GOLD)
        .setDescription('Hoki! Kamu mendapat **' + reward.toLocaleString('id-ID') + ' BFL** dari Box Premium VIP!')
        .addFields({ name: 'Saldo Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL' });
      return message.reply({ embeds: [embed] });
    } else {
      saveDB(db);
      const embed = new EmbedBuilder()
        .setTitle('📦 BOX PREMIUM - Tidak Beruntung')
        .setColor(C_RED)
        .setDescription('Sayang sekali, Box Premium kali ini kosong!\nCoba lagi keberuntunganmu (30% chance menang).')
        .setFooter({ text: 'VIP Dewa Kera tetap aktif' });
      return message.reply({ embeds: [embed] });
    }
  }

  // ======================== !top (admin) ========================
  if (command === 'top') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Command !top hanya bisa digunakan oleh admin!');
    const sorted = Object.values(db.users).sort((a, b) => b.balance - a.balance).slice(0, 10);
    const list = sorted.map((u, i) => (i + 1) + '. ' + (u.discordTag || u.noHp) + ' - ' + u.balance.toLocaleString('id-ID') + ' BFL').join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Leaderboard BFL Coin')
      .setColor(C_GOLD)
      .setDescription(list || 'Belum ada data.')
      .setFooter({ text: 'Top 10 saldo tertinggi' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !topup ========================
  if (command === 'topup') {
    if (!isDM) return message.reply('Topup hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar! Ketik `!register` dulu.');

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < MIN_TOPUP) {
      return message.reply('Minimal topup Rp' + MIN_TOPUP.toLocaleString('id-ID') + '\nFormat: `!topup <jumlah>`');
    }

    db.pendingTopup[message.author.id] = { amount, timestamp: new Date().toISOString() };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Request Topup BFL Coin')
      .setColor(C_BLUE)
      .setDescription('Transfer Rp' + amount.toLocaleString('id-ID') + ' ke DANA berikut:')
      .addFields(
        { name: 'No DANA Admin', value: DANA_ADMIN, inline: true },
        { name: 'Jumlah Transfer', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
        { name: 'Berita Transfer', value: 'TOPUP-' + message.author.id.slice(-4), inline: false },
        { name: 'Langkah Selanjutnya', value: '1. Transfer ke DANA admin\n2. Screenshot bukti transfer\n3. Kirim screenshot ke admin Discord\n4. Tunggu konfirmasi' }
      )
      .setFooter({ text: 'Diproses maks 1x24 jam' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !tarik ========================
  if (command === 'tarik') {
    if (!isDM) return message.reply('Tarik hanya bisa di DM bot!');
    if (!user) return message.reply('Belum terdaftar!');

    const amount = parseInt(args[0]);
    const noHp   = args[1];

    if (isNaN(amount) || amount < MIN_TARIK) {
      return message.reply(
        '❌ Format salah atau jumlah kurang dari minimum.\n' +
        'Format: `!tarik <jumlah> <no_dana>`\n' +
        'Contoh: `!tarik 10000 08123456789`\n' +
        'Minimal tarik: Rp' + MIN_TARIK.toLocaleString('id-ID')
      );
    }
    if (!noHp || !/^0[0-9]{9,12}$/.test(noHp)) {
      return message.reply(
        '❌ Nomor DANA tidak valid!\n' +
        'Format: `!tarik <jumlah> <no_dana>`\n' +
        'Contoh: `!tarik 10000 08123456789`'
      );
    }
    if (user.balance < amount) return message.reply('Saldo tidak cukup! Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL');

    const dupUser = Object.values(db.users).find(u => u.noHp === noHp && u.discordId !== message.author.id);
    if (dupUser) return message.reply('❌ Nomor DANA ini sudah terdaftar di akun lain!');

    user.noHp     = noHp;
    user.balance -= amount;
    db.pendingTarik[message.author.id] = { amount, noHp, timestamp: new Date().toISOString() };
    saveDB(db);

    try {
      const adminUser = await client.users.fetch(ADMIN_ID);
      const notif = new EmbedBuilder()
        .setTitle('NOTIF: REQUEST TARIK BARU')
        .setColor(C_ORANGE)
        .addFields(
          { name: 'User', value: message.author.tag + ' (' + message.author.id + ')', inline: false },
          { name: 'No DANA Tujuan', value: noHp, inline: true },
          { name: 'Jumlah', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
          { name: 'Perintah Approve', value: '`!approve ' + message.author.id + ' ' + amount + '`', inline: true },
          { name: 'Perintah Tolak', value: '`!reject ' + message.author.id + '`', inline: true }
        );
      await adminUser.send({ embeds: [notif] });
    } catch (e) { console.log('Gagal kirim notif admin:', e.message); }

    const embed = new EmbedBuilder()
      .setTitle('Request Tarik Terkirim ✅')
      .setColor(C_BLUE)
      .setDescription('Permintaan tarik Rp' + amount.toLocaleString('id-ID') + ' telah dikirim ke admin.')
      .addFields(
        { name: 'No DANA Tujuan', value: noHp, inline: true },
        { name: 'Estimasi Proses', value: 'Maksimal 1x24 jam' }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !topupok (admin) ========================
  if (command === 'topupok') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!topupok <discordId> <jumlah>`');

    const targetUser = getUserByDiscordId(db, targetId);
    if (!targetUser) return message.reply('User tidak ditemukan!');

    targetUser.balance += amount;
    delete db.pendingTopup[targetId];
    db.transactions.push({ type: 'topup', to: targetId, amount, approvedBy: ADMIN_ID, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      await u.send({ embeds: [
        new EmbedBuilder()
          .setTitle('Topup Berhasil!')
          .setColor(C_GREEN)
          .setDescription('Topup ' + amount.toLocaleString('id-ID') + ' BFL berhasil masuk!')
          .addFields({ name: 'Saldo Baru', value: targetUser.balance.toLocaleString('id-ID') + ' BFL' })
      ]});
    } catch (e) { console.log('Gagal DM user:', e.message); }

    return message.reply('Topup Rp' + amount.toLocaleString('id-ID') + ' untuk <@' + targetId + '> berhasil!');
  }

  // ======================== !approve (admin) ========================
  if (command === 'approve') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!approve <discordId> <jumlah>`');

    delete db.pendingTarik[targetId];
    db.transactions.push({ type: 'tarik', from: targetId, amount, approvedBy: ADMIN_ID, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      await u.send({ embeds: [
        new EmbedBuilder()
          .setTitle('Tarik Diproses!')
          .setColor(C_GREEN)
          .setDescription('Penarikan Rp' + amount.toLocaleString('id-ID') + ' ke DANA kamu sedang dikirim!')
      ]});
    } catch (e) {}

    return message.reply('Tarik Rp' + amount.toLocaleString('id-ID') + ' untuk <@' + targetId + '> disetujui!');
  }

  // ======================== !reject (admin) ========================
  if (command === 'reject') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const pending  = db.pendingTarik[targetId];
    if (!pending) return message.reply('Tidak ada request tarik dari user ini.');

    const targetUser = getUserByDiscordId(db, targetId);
    if (targetUser) targetUser.balance += pending.amount;
    delete db.pendingTarik[targetId];
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      await u.send('Request tarik Rp' + pending.amount.toLocaleString('id-ID') + ' ditolak. Saldo dikembalikan.');
    } catch (e) {}

    return message.reply('Request dari <@' + targetId + '> ditolak dan saldo dikembalikan.');
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

  // ======================== !allusers (admin) ========================
  if (command === 'allusers') {
    if (message.author.id !== ADMIN_ID) return;
    const list = Object.values(db.users)
      .map(u => (u.discordTag || u.noHp) + ': ' + u.balance.toLocaleString('id-ID') + ' BFL | ❤️' + (u.hunger ?? 100) + '%')
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Semua User BFL Coin')
      .setColor(C_BLUE)
      .setDescription((list || 'Belum ada user terdaftar.').slice(0, 4000));
    return message.reply({ embeds: [embed] });
  }

  // ======================== !addbalance (admin) ========================
  if (command === 'addbalance') {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Hanya admin yang bisa menggunakan command ini!');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('Format: `!addbalance <jumlah>`');

    const adminUser = getUserByDiscordId(db, ADMIN_ID);
    if (!adminUser) return message.reply('❌ Akun admin tidak ditemukan!');
    adminUser.balance += amount;
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Saldo Admin Ditambah')
        .setColor(C_GREEN)
        .addFields(
          { name: 'Ditambah', value: 'Rp' + amount.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: 'Saldo Baru', value: adminUser.balance.toLocaleString('id-ID') + ' BFL', inline: true }
        )
    ]});
  }

  // ======================== !setmakan (admin DM only) ========================
  // Poin 6: Admin bisa custom nama & harga makan via DM
  // Format: !setmakan <harga> <nama> <deskripsi>
  // Contoh: !setmakan 750 "Nasi Padang" "Makan enak penambah tenaga"
  if (command === 'setmakan') {
    if (message.author.id !== ADMIN_ID) return;
    if (!isDM) return message.reply('⚠️ Command !setmakan hanya bisa digunakan di DM admin!');

    const price = parseInt(args[0]);
    if (isNaN(price) || price <= 0) {
      return message.reply(
        '❌ Format salah!\n' +
        'Format: `!setmakan <harga> <nama> <deskripsi>`\n' +
        'Contoh: `!setmakan 750 NasiPadang Makan enak penambah tenaga`'
      );
    }

    const nama = args[1] || 'Makan & Minum';
    const desc = args.slice(2).join(' ') || 'Bekal untuk beraktivitas';

    db.foodConfig = { price, name: nama, description: desc };
    saveDB(db);

    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('✅ Konfigurasi Makan/Minum Diperbarui!')
        .setColor(C_GREEN)
        .addFields(
          { name: 'Nama Item', value: nama, inline: true },
          { name: 'Harga Baru', value: price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: 'Deskripsi', value: desc }
        )
        .setFooter({ text: 'Player membeli dengan !beli makan | Nyawa penuh setelah beli' })
    ]});
  }

  // ======================== !cekfood (admin) ========================
  if (command === 'cekfood') {
    if (message.author.id !== ADMIN_ID) return;
    const fc = db.foodConfig || { price: DEFAULT_FOOD_PRICE, name: 'Makan & Minum', description: 'Bekal untuk beraktivitas' };
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setTitle('🍱 Konfigurasi Makan/Minum Saat Ini')
        .setColor(C_BLUE)
        .addFields(
          { name: 'Nama', value: fc.name, inline: true },
          { name: 'Harga', value: fc.price.toLocaleString('id-ID') + ' BFL', inline: true },
          { name: 'Deskripsi', value: fc.description || '-' }
        )
        .setFooter({ text: 'Ubah dengan: !setmakan <harga> <nama> <deskripsi>' })
    ]});
  }

  // ======================== !admincheck ========================
  if (command === 'admincheck') {
    if (message.author.id !== ADMIN_ID) {
      return message.reply('❌ Kamu BUKAN admin.\nID kamu: `' + message.author.id + '`');
    }
    return message.reply('✅ Kamu adalah ADMIN! ID: `' + message.author.id + '`');
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
