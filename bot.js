const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const fs = require('fs');

// ============================================================
// DATABASE
// ============================================================
const DB_FILE = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      users: {
        "ADMIN_085640241324": {
          discordId: "ADMIN_PLACEHOLDER",
          noHp: "085640241324",
          balance: 225000,
          registered: true,
          registeredAt: new Date().toISOString()
        }
      },
      transactions: [],
      pendingTopup: {},
      pendingTarik: {}
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('DB corrupt, reset:', e.message);
    fs.unlinkSync(DB_FILE);
    return loadDB();
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUserByDiscordId(db, discordId) {
  return Object.values(db.users).find(u => u.discordId === discordId);
}

// ============================================================
// CONFIG
// ============================================================
const TOKEN       = process.env.DISCORD_TOKEN;
const ADMIN_ID    = process.env.ADMIN_DISCORD_ID;
const DANA_ADMIN  = '085640241324';
const DONATE_LINK = process.env.DONATE_LINK || 'https://saweria.co/bflcoin';
const PREFIX      = '!';
const MIN_TARIK   = 10000;
const MIN_TOPUP   = 10000;
const C_GOLD      = 0xFFD700;
const C_GREEN     = 0x00FF7F;
const C_RED       = 0xFF4444;
const C_BLUE      = 0x00BFFF;
const C_ORANGE    = 0xFF8C00;

if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN belum diset!');
  process.exit(1);
}
if (!ADMIN_ID) {
  console.error('ERROR: ADMIN_DISCORD_ID belum diset!');
  process.exit(1);
}

// ============================================================
// CLIENT — PENTING: Partials lengkap agar DM bisa berjalan
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
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Channel,    // WAJIB untuk DM
    Partials.Message,    // WAJIB untuk DM
    Partials.User,
    Partials.GuildMember,
    Partials.Reaction,
  ]
});

client.once('ready', () => {
  console.log('Bot aktif: ' + client.user.tag);
  const db = loadDB();
  if (db.users['ADMIN_085640241324'] && db.users['ADMIN_085640241324'].discordId === 'ADMIN_PLACEHOLDER') {
    db.users['ADMIN_085640241324'].discordId = ADMIN_ID;
    db.users['ADMIN_085640241324'].discordTag = 'Admin';
    saveDB(db);
    console.log('Admin ID diset: ' + ADMIN_ID);
  }
  client.user.setActivity('!help | BFL Coin', { type: 3 });
});

// ============================================================
// HELPER: cek apakah pesan dari DM
// ============================================================
function isDMChannel(channel) {
  // type 1 = DM, tapi channel partial mungkin belum punya type
  // Gunakan cara yang lebih robust:
  return !channel.guild;
}

// ============================================================
// MESSAGE HANDLER
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Fetch channel jika partial (PENTING untuk DM)
  if (message.channel.partial) {
    try { await message.channel.fetch(); }
    catch (e) { console.error('Gagal fetch channel:', e); return; }
  }

  if (!message.content.startsWith(PREFIX)) return;

  const parts   = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = parts.shift().toLowerCase();
  const args    = parts;

  const db   = loadDB();
  const isDM = isDMChannel(message.channel);
  const user = getUserByDiscordId(db, message.author.id);

  console.log('[CMD] ' + message.author.tag + ' | ' + command + ' | DM=' + isDM);

  // ======================== !help ========================
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('BFL Coin Bot - Panduan Lengkap')
      .setColor(C_GOLD)
      .setDescription('1 BFL = 1 Rupiah Indonesia\nRegister hanya di DM bot ini!')
      .addFields(
        { name: 'REGISTRASI (DM Bot)', value: '!register <no_dana>\nContoh: !register 08123456789' },
        { name: 'CEK SALDO', value: '!saldo' },
        { name: 'PROFIL', value: '!profile' },
        { name: 'TIP', value: '!tip @user <jumlah>' },
        { name: 'RAIN / PARTY', value: '!rain <jumlah> - Bagikan ke yang aktif di channel' },
        { name: 'DADU 1v1', value: '!dadu @user <taruhan> - Angka terbesar menang!' },
        { name: 'SLOT', value: '!slot <taruhan> - Main slot mesin!' },
        { name: 'LEADERBOARD', value: '!top - Ranking saldo tertinggi' },
        { name: 'TOPUP (DM Bot)', value: '!topup <jumlah> - Min Rp' + MIN_TOPUP.toLocaleString('id-ID') },
        { name: 'TARIK (DM Bot)', value: '!tarik <jumlah> - Min Rp' + MIN_TARIK.toLocaleString('id-ID') },
        { name: 'DONASI', value: DONATE_LINK }
      )
      .setFooter({ text: 'DANA Admin: ' + DANA_ADMIN });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !register ========================
  if (command === 'register') {
    if (!isDM) {
      return message.reply('Registrasi hanya bisa di DM (pesan pribadi) bot ini!\nKlik nama bot -> Kirim Pesan, lalu ketik !register <no_dana>');
    }
    if (user) return message.reply('Kamu sudah terdaftar! Gunakan !saldo untuk cek saldo.');

    const noHp = args[0];
    if (!noHp || !/^0[0-9]{9,12}$/.test(noHp)) {
      return message.reply('Format nomor tidak valid.\nContoh: !register 08123456789');
    }
    const existing = Object.values(db.users).find(u => u.noHp === noHp);
    if (existing) return message.reply('Nomor DANA ini sudah terdaftar di akun lain!');

    db.users['USER_' + noHp] = {
      discordId: message.author.id,
      discordTag: message.author.tag,
      noHp: noHp,
      balance: 0,
      registered: true,
      registeredAt: new Date().toISOString()
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Registrasi Berhasil!')
      .setColor(C_GREEN)
      .setDescription('Selamat datang di BFL Coin, ' + message.author.username + '!')
      .addFields(
        { name: 'No DANA', value: noHp, inline: true },
        { name: 'Saldo Awal', value: '0 BFL', inline: true },
        { name: 'Langkah Selanjutnya', value: 'Gunakan !topup <jumlah> di sini untuk isi saldo.\nContoh: !topup 10000' }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !saldo ========================
  if (command === 'saldo') {
    if (!user) return message.reply('Belum terdaftar! Kirim pesan ke DM bot: !register <no_dana>');
    const embed = new EmbedBuilder()
      .setTitle('Saldo BFL Coin - ' + message.author.username)
      .setColor(C_GOLD)
      .setDescription(user.balance.toLocaleString('id-ID') + ' BFL\n= Rp' + user.balance.toLocaleString('id-ID'))
      .setFooter({ text: 'Min tarik: Rp' + MIN_TARIK.toLocaleString('id-ID') });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !profile ========================
  if (command === 'profile') {
    if (!user) return message.reply('Belum terdaftar!');
    const txCount = db.transactions.filter(t => t.from === message.author.id || t.to === message.author.id).length;
    const embed = new EmbedBuilder()
      .setTitle('Profil - ' + message.author.username)
      .setColor(C_BLUE)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: 'No DANA', value: user.noHp, inline: true },
        { name: 'Saldo', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Total Transaksi', value: String(txCount), inline: true },
        { name: 'Bergabung', value: new Date(user.registeredAt).toLocaleDateString('id-ID'), inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !tip ========================
  if (command === 'tip') {
    if (isDM) return message.reply('Command !tip hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar! DM bot dan ketik !register <no_dana>');

    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('Format: !tip @user <jumlah>');
    if (target.id === message.author.id) return message.reply('Tidak bisa tip ke diri sendiri!');
    if (target.bot) return message.reply('Tidak bisa tip ke bot!');
    if (user.balance < amount) return message.reply('Saldo tidak cukup! Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar di BFL Coin!');

    user.balance -= amount;
    targetUser.balance += amount;
    db.transactions.push({ type: 'tip', from: message.author.id, to: target.id, amount: amount, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Tip Berhasil!')
      .setColor(C_GREEN)
      .setDescription(message.author.username + ' mengirim ' + amount.toLocaleString('id-ID') + ' BFL ke ' + target.username + '!')
      .addFields({ name: 'Saldo Kamu Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !rain / !party ========================
  if (command === 'rain' || command === 'party') {
    if (isDM) return message.reply('Command !rain hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('Format: !rain <jumlah>');
    if (user.balance < amount) return message.reply('Saldo tidak cukup! Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL');

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
    db.transactions.push({ type: 'rain', from: message.author.id, amount: amount, recipients: eligible.length, timestamp: new Date().toISOString() });
    saveDB(db);

    const mentions = eligible.map(a => '<@' + a.id + '>').join(' ');
    const embed = new EmbedBuilder()
      .setTitle('RAIN / PARTY BFL Coin!')
      .setColor(C_GOLD)
      .setDescription(message.author.username + ' membagikan hujan koin!\n\n' + mentions + '\n\nMasing-masing mendapat ' + perPerson.toLocaleString('id-ID') + ' BFL!')
      .addFields({ name: 'Total Dibagikan', value: (perPerson * eligible.length).toLocaleString('id-ID') + ' BFL ke ' + eligible.length + ' orang' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !dadu ========================
  if (command === 'dadu') {
    if (isDM) return message.reply('Command !dadu hanya bisa di server Discord!');
    if (!user) return message.reply('Belum terdaftar!');

    const target = message.mentions.users.first();
    const bet    = parseInt(args[1]);
    if (!target || isNaN(bet) || bet <= 0) return message.reply('Format: !dadu @user <taruhan>');
    if (target.bot || target.id === message.author.id) return message.reply('Target tidak valid!');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(target.username + ' belum terdaftar!');
    if (targetUser.balance < bet) return message.reply(target.username + ' tidak punya saldo cukup!');

    const diceA = Math.floor(Math.random() * 6) + 1;
    const diceB = Math.floor(Math.random() * 6) + 1;

    let resultText = '';
    if (diceA > diceB) {
      user.balance += bet;
      targetUser.balance -= bet;
      resultText = message.author.username + ' MENANG ' + bet.toLocaleString('id-ID') + ' BFL!';
    } else if (diceB > diceA) {
      user.balance -= bet;
      targetUser.balance += bet;
      resultText = target.username + ' MENANG ' + bet.toLocaleString('id-ID') + ' BFL!';
    } else {
      resultText = 'SERI! Tidak ada yang menang, taruhan dikembalikan.';
    }

    db.transactions.push({ type: 'dadu', playerA: message.author.id, playerB: target.id, bet: bet, diceA: diceA, diceB: diceB, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Adu Dadu!')
      .setColor(C_GOLD)
      .setDescription(resultText)
      .addFields(
        { name: message.author.username, value: 'Dadu: ' + diceA, inline: true },
        { name: 'VS', value: '---', inline: true },
        { name: target.username, value: 'Dadu: ' + diceB, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !slot ========================
  if (command === 'slot') {
    if (!user) return message.reply('Belum terdaftar!');
    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('Format: !slot <taruhan>');
    if (user.balance < bet) return message.reply('Saldo tidak cukup!');

    const symbols = ['Ceri', 'Lemon', 'Jeruk', 'Anggur', 'Bintang', 'Berlian', 'Tujuh'];
    const spin = [
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
      symbols[Math.floor(Math.random() * symbols.length)]
    ];
    const line = '[ ' + spin.join(' | ') + ' ]';

    let multiplier = 0;
    if (spin[0] === spin[1] && spin[1] === spin[2]) {
      if (spin[0] === 'Berlian') multiplier = 10;
      else if (spin[0] === 'Tujuh') multiplier = 7;
      else if (spin[0] === 'Bintang') multiplier = 5;
      else multiplier = 3;
    } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
      multiplier = 2;
    }

    const won = Math.floor(bet * multiplier);
    user.balance += (won - bet);
    if (user.balance < 0) user.balance = 0;
    saveDB(db);

    const hasilText = multiplier > 0
      ? 'MENANG +' + won.toLocaleString('id-ID') + ' BFL (x' + multiplier + ')'
      : 'Kalah -' + bet.toLocaleString('id-ID') + ' BFL';

    const embed = new EmbedBuilder()
      .setTitle('SLOT MACHINE')
      .setColor(multiplier > 0 ? C_GREEN : C_RED)
      .setDescription(line)
      .addFields(
        { name: 'Taruhan', value: bet.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Hasil', value: hasilText, inline: true },
        { name: 'Saldo Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !top ========================
  if (command === 'top') {
    const sorted = Object.values(db.users).sort((a, b) => b.balance - a.balance).slice(0, 10);
    const list = sorted.map((u, i) => (i + 1) + '. ' + (u.discordTag || u.noHp) + ' - ' + u.balance.toLocaleString('id-ID') + ' BFL').join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Leaderboard BFL Coin')
      .setColor(C_GOLD)
      .setDescription(list || 'Belum ada data.')
      .setFooter({ text: 'Top 10 saldo tertinggi' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !topup (DM) ========================
  if (command === 'topup') {
    if (!isDM) return message.reply('Topup hanya bisa di DM bot! Klik nama bot -> Kirim Pesan');
    if (!user) return message.reply('Belum terdaftar! Ketik !register <no_dana> dulu.');

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < MIN_TOPUP) {
      return message.reply('Minimal topup Rp' + MIN_TOPUP.toLocaleString('id-ID') + '\nFormat: !topup <jumlah>\nContoh: !topup 10000');
    }

    db.pendingTopup[message.author.id] = { amount: amount, timestamp: new Date().toISOString() };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('Request Topup BFL Coin')
      .setColor(C_BLUE)
      .setDescription('Transfer Rp' + amount.toLocaleString('id-ID') + ' ke DANA berikut:')
      .addFields(
        { name: 'No DANA Admin', value: DANA_ADMIN, inline: true },
        { name: 'Jumlah Transfer', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
        { name: 'Berita Transfer', value: 'TOPUP-' + message.author.id.slice(-4), inline: false },
        { name: 'Langkah Selanjutnya', value: '1. Transfer ke DANA admin\n2. Screenshot bukti transfer\n3. Kirim screenshot ke admin Discord\n4. Tunggu konfirmasi, saldo masuk otomatis' }
      )
      .setFooter({ text: 'Diproses maks 1x24 jam' });
    return message.reply({ embeds: [embed] });
  }

  // ======================== !tarik (DM) ========================
  if (command === 'tarik') {
    if (!isDM) return message.reply('Tarik hanya bisa di DM bot! Klik nama bot -> Kirim Pesan');
    if (!user) return message.reply('Belum terdaftar!');

    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < MIN_TARIK) {
      return message.reply('Minimal tarik Rp' + MIN_TARIK.toLocaleString('id-ID') + '\nFormat: !tarik <jumlah>');
    }
    if (user.balance < amount) {
      return message.reply('Saldo tidak cukup! Saldo: ' + user.balance.toLocaleString('id-ID') + ' BFL');
    }

    user.balance -= amount;
    db.pendingTarik[message.author.id] = { amount: amount, noHp: user.noHp, timestamp: new Date().toISOString() };
    saveDB(db);

    try {
      const adminUser = await client.users.fetch(ADMIN_ID);
      const notif = new EmbedBuilder()
        .setTitle('NOTIF: REQUEST TARIK BARU')
        .setColor(C_ORANGE)
        .addFields(
          { name: 'User', value: message.author.tag + ' (' + message.author.id + ')', inline: false },
          { name: 'No DANA Tujuan', value: user.noHp, inline: true },
          { name: 'Jumlah', value: 'Rp' + amount.toLocaleString('id-ID'), inline: true },
          { name: 'Waktu', value: new Date().toLocaleString('id-ID'), inline: false },
          { name: 'Perintah Approve', value: '!approve ' + message.author.id + ' ' + amount, inline: true },
          { name: 'Perintah Tolak', value: '!reject ' + message.author.id, inline: true }
        );
      await adminUser.send({ embeds: [notif] });
    } catch (e) {
      console.log('Gagal kirim notif admin:', e.message);
    }

    const embed = new EmbedBuilder()
      .setTitle('Request Tarik Terkirim')
      .setColor(C_BLUE)
      .setDescription('Permintaan tarik Rp' + amount.toLocaleString('id-ID') + ' telah dikirim ke admin.')
      .addFields(
        { name: 'No DANA Tujuan', value: user.noHp, inline: true },
        { name: 'Saldo Sekarang', value: user.balance.toLocaleString('id-ID') + ' BFL', inline: true },
        { name: 'Estimasi Proses', value: 'Maksimal 1x24 jam', inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ======================== !topupok (admin) ========================
  if (command === 'topupok') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: !topupok <discordId> <jumlah>');

    const targetUser = getUserByDiscordId(db, targetId);
    if (!targetUser) return message.reply('User tidak ditemukan!');

    targetUser.balance += amount;
    delete db.pendingTopup[targetId];
    db.transactions.push({ type: 'topup', to: targetId, amount: amount, approvedBy: ADMIN_ID, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      const embed = new EmbedBuilder()
        .setTitle('Topup Berhasil!')
        .setColor(C_GREEN)
        .setDescription('Topup ' + amount.toLocaleString('id-ID') + ' BFL berhasil masuk!')
        .addFields({ name: 'Saldo Baru', value: targetUser.balance.toLocaleString('id-ID') + ' BFL' });
      await u.send({ embeds: [embed] });
    } catch (e) { console.log('Gagal DM user:', e.message); }

    return message.reply('Topup Rp' + amount.toLocaleString('id-ID') + ' untuk <@' + targetId + '> berhasil!');
  }

  // ======================== !approve (admin) ========================
  if (command === 'approve') {
    if (message.author.id !== ADMIN_ID) return;
    const targetId = args[0];
    const amount   = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: !approve <discordId> <jumlah>');

    delete db.pendingTarik[targetId];
    db.transactions.push({ type: 'tarik', from: targetId, amount: amount, approvedBy: ADMIN_ID, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      const embed = new EmbedBuilder()
        .setTitle('Tarik Diproses!')
        .setColor(C_GREEN)
        .setDescription('Penarikan Rp' + amount.toLocaleString('id-ID') + ' ke DANA kamu sedang dikirim!')
        .addFields({ name: 'Estimasi', value: 'Beberapa menit sampai 1 jam' });
      await u.send({ embeds: [embed] });
    } catch (e) { console.log('Gagal DM user:', e.message); }

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
      await u.send('Request tarik Rp' + pending.amount.toLocaleString('id-ID') + ' ditolak. Saldo dikembalikan. Hubungi admin untuk info.');
    } catch (e) {}

    return message.reply('Request dari <@' + targetId + '> ditolak dan saldo dikembalikan.');
  }

  // ======================== !givecoin (admin) ========================
  if (command === 'givecoin') {
    if (message.author.id !== ADMIN_ID) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('Format: !givecoin @user <jumlah>');

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('User belum terdaftar!');

    targetUser.balance += amount;
    saveDB(db);
    return message.reply('Berhasil memberi ' + amount.toLocaleString('id-ID') + ' BFL ke ' + target.username + '!');
  }

  // ======================== !allusers (admin) ========================
  if (command === 'allusers') {
    if (message.author.id !== ADMIN_ID) return;
    const list = Object.values(db.users).map(u => (u.discordTag || u.noHp) + ': ' + u.balance.toLocaleString('id-ID') + ' BFL').join('\n');
    const embed = new EmbedBuilder()
      .setTitle('Semua User BFL Coin')
      .setColor(C_BLUE)
      .setDescription(list || 'Belum ada user terdaftar.');
    return message.reply({ embeds: [embed] });
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(TOKEN);
