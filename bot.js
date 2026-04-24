const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ===================== DATABASE SEDERHANA =====================
const DB_FILE = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const init = {
      users: {
        "ADMIN_085640241324": {
          discordId: "ADMIN",
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
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getUserByDiscordId(db, discordId) {
  return Object.values(db.users).find(u => u.discordId === discordId);
}

function getUserKey(noHp) {
  return `USER_${noHp}`;
}

// ===================== CONFIG =====================
const config = {
  TOKEN: process.env.DISCORD_TOKEN,
  ADMIN_ID: process.env.ADMIN_DISCORD_ID, // Discord ID kamu (bukan nomor HP)
  ADMIN_HP: "085640241324",
  PREFIX: "!",
  COIN_NAME: "BFL",
  MIN_TARIK: 10000,
  MIN_TOPUP: 10000,
  DANA_ADMIN: "085640241324",
  DONATE_LINK: process.env.DONATE_LINK || "https://saweria.co/bflcoin",
  COIN_EMOJI: "🪙",
  COLOR_MAIN: 0xFFD700,
  COLOR_SUCCESS: 0x00FF7F,
  COLOR_ERROR: 0xFF4444,
  COLOR_INFO: 0x00BFFF,
};

// ===================== CLIENT =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

// ===================== READY =====================
client.once('ready', () => {
  console.log(`✅ Bot BFL Coin aktif sebagai ${client.user.tag}`);
  client.user.setActivity(`!help | BFL Coin 🪙`, { type: 3 });
});

// ===================== MESSAGE HANDLER =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.PREFIX)) return;

  const args = message.content.slice(config.PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  const db = loadDB();
  const isDM = message.channel.type === 1;
  const user = getUserByDiscordId(db, message.author.id);

  // ===================== HELP =====================
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle(`${config.COIN_EMOJI} BFL Coin Bot — Panduan Lengkap`)
      .setColor(config.COLOR_MAIN)
      .setDescription(`**BFL Coin** adalah sistem koin digital sederhana.\n1 ${config.COIN_NAME} = 1 Rupiah 🇮🇩`)
      .addFields(
        { name: '📋 Registrasi (DM Bot)', value: '`!register <no_dana>`\nContoh: `!register 08123456789`', inline: false },
        { name: '💰 Cek Saldo', value: '`!saldo` — Cek saldo koin kamu', inline: true },
        { name: '📊 Profile', value: '`!profile` — Lihat profil lengkap', inline: true },
        { name: '🎁 Tip', value: '`!tip @user <jumlah>` — Kirim koin ke user lain', inline: false },
        { name: '🌧️ Rain / Party', value: '`!rain <jumlah>` — Bagikan koin ke yang aktif di channel', inline: false },
        { name: '🎲 Dadu', value: '`!dadu @user <taruhan>` — Adu dadu, angka terbesar menang!', inline: false },
        { name: '📥 Topup (DM Bot)', value: '`!topup <jumlah>` — Isi saldo via DANA', inline: false },
        { name: '📤 Tarik (DM Bot)', value: '`!tarik <jumlah>` — Tarik saldo ke DANA', inline: false },
        { name: '🏆 Leaderboard', value: '`!top` — Ranking saldo tertinggi', inline: true },
        { name: '🎰 Slot', value: '`!slot <taruhan>` — Main slot mesin!', inline: true },
        { name: '💸 Donasi', value: `[Dukung Bot ini](${config.DONATE_LINK})`, inline: false },
      )
      .setFooter({ text: `DANA Admin: ${config.DANA_ADMIN} | Min Tarik/Topup: Rp${config.MIN_TARIK.toLocaleString()}` })
      .setThumbnail('https://imgur.com/a/dFAsuHC');
    return message.reply({ embeds: [embed] });
  }

  // ===================== REGISTER =====================
  if (command === 'register') {
    if (!isDM) return message.reply('⚠️ Registrasi hanya bisa dilakukan di **DM (pesan pribadi)** bot ini!');
    if (user) return message.reply('✅ Kamu sudah terdaftar! Gunakan `!saldo` untuk cek saldo.');
    const noHp = args[0];
    if (!noHp || !/^0[0-9]{9,12}$/.test(noHp)) {
      return message.reply('❌ Format nomor DANA tidak valid!\nContoh: `!register 08123456789`');
    }
    const existing = Object.values(db.users).find(u => u.noHp === noHp);
    if (existing) return message.reply('❌ Nomor DANA ini sudah digunakan akun lain!');

    const key = getUserKey(noHp);
    db.users[key] = {
      discordId: message.author.id,
      discordTag: message.author.tag,
      noHp,
      balance: 0,
      registered: true,
      registeredAt: new Date().toISOString()
    };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🎉 Registrasi Berhasil!')
      .setColor(config.COLOR_SUCCESS)
      .setDescription(`Selamat datang di **BFL Coin**, ${message.author.username}!`)
      .addFields(
        { name: '📱 No DANA', value: noHp, inline: true },
        { name: `${config.COIN_EMOJI} Saldo`, value: `0 ${config.COIN_NAME}`, inline: true },
        { name: '📖 Mulai', value: 'Gunakan `!help` untuk melihat semua perintah.\nLakukan `!topup` untuk mengisi saldo.' }
      )
      .setThumbnail('https://i.imgur.com/ybQAKZt.png');
    return message.reply({ embeds: [embed] });
  }

  // ===================== SALDO =====================
  if (command === 'saldo') {
    if (!user) return message.reply('❌ Kamu belum terdaftar! Lakukan `!register <no_dana>` di DM bot.');
    const embed = new EmbedBuilder()
      .setTitle(`${config.COIN_EMOJI} Saldo Kamu`)
      .setColor(config.COLOR_MAIN)
      .setDescription(`**${user.balance.toLocaleString()} ${config.COIN_NAME}**\n= Rp${user.balance.toLocaleString()}`)
      .setFooter({ text: `Min tarik: Rp${config.MIN_TARIK.toLocaleString()}` });
    return message.reply({ embeds: [embed] });
  }

  // ===================== PROFILE =====================
  if (command === 'profile') {
    if (!user) return message.reply('❌ Kamu belum terdaftar!');
    const txCount = db.transactions.filter(t => t.from === message.author.id || t.to === message.author.id).length;
    const embed = new EmbedBuilder()
      .setTitle(`👤 Profile — ${message.author.username}`)
      .setColor(config.COLOR_INFO)
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        { name: '📱 No DANA', value: user.noHp, inline: true },
        { name: `${config.COIN_EMOJI} Saldo`, value: `${user.balance.toLocaleString()} ${config.COIN_NAME}`, inline: true },
        { name: '📊 Transaksi', value: `${txCount}x`, inline: true },
        { name: '📅 Bergabung', value: new Date(user.registeredAt).toLocaleDateString('id-ID'), inline: true },
      );
    return message.reply({ embeds: [embed] });
  }

  // ===================== TIP =====================
  if (command === 'tip') {
    if (isDM) return message.reply('❌ Command ini hanya bisa digunakan di server Discord!');
    if (!user) return message.reply('❌ Kamu belum terdaftar! Daftar dulu dengan `!register` di DM.');
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount) || amount <= 0) return message.reply('❌ Format: `!tip @user <jumlah>`');
    if (target.id === message.author.id) return message.reply('❌ Kamu tidak bisa tip diri sendiri!');
    if (target.bot) return message.reply('❌ Tidak bisa tip ke bot!');
    if (user.balance < amount) return message.reply(`❌ Saldo tidak cukup! Saldo kamu: **${user.balance.toLocaleString()} ${config.COIN_NAME}**`);

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(`❌ ${target.username} belum terdaftar di BFL Coin!`);

    user.balance -= amount;
    targetUser.balance += amount;
    db.transactions.push({ type: 'tip', from: message.author.id, to: target.id, amount, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('💸 Tip Berhasil!')
      .setColor(config.COLOR_SUCCESS)
      .setDescription(`**${message.author.username}** mengirim **${amount.toLocaleString()} ${config.COIN_NAME}** ke **${target.username}**!`)
      .addFields(
        { name: 'Saldo Kamu Sekarang', value: `${user.balance.toLocaleString()} ${config.COIN_NAME}`, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // ===================== RAIN / PARTY =====================
  if (command === 'rain' || command === 'party') {
    if (isDM) return message.reply('❌ Command ini hanya bisa di server Discord!');
    if (!user) return message.reply('❌ Kamu belum terdaftar!');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) return message.reply('❌ Format: `!rain <jumlah>`');
    if (user.balance < amount) return message.reply(`❌ Saldo tidak cukup! Saldo: **${user.balance.toLocaleString()} ${config.COIN_NAME}**`);

    const msgs = await message.channel.messages.fetch({ limit: 50 });
    const activeUsers = [...new Set(msgs.map(m => m.author).filter(a => !a.bot && a.id !== message.author.id))];
    const eligible = activeUsers.filter(a => getUserByDiscordId(db, a.id));

    if (eligible.length === 0) return message.reply('❌ Tidak ada user aktif yang terdaftar di channel ini!');
    const perPerson = Math.floor(amount / eligible.length);
    if (perPerson < 1) return message.reply(`❌ Jumlah terlalu kecil untuk dibagi ${eligible.length} orang!`);

    user.balance -= perPerson * eligible.length;
    eligible.forEach(a => {
      const u = getUserByDiscordId(db, a.id);
      u.balance += perPerson;
    });
    db.transactions.push({ type: 'rain', from: message.author.id, amount, recipients: eligible.length, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🌧️ RAIN / PARTY!')
      .setColor(config.COLOR_MAIN)
      .setDescription(`**${message.author.username}** membagikan hujan koin!\n\n${eligible.map(a => `<@${a.id}>`).join(' ')} masing-masing mendapat **${perPerson.toLocaleString()} ${config.COIN_NAME}**!`)
      .addFields({ name: 'Total Dibagikan', value: `${(perPerson * eligible.length).toLocaleString()} ${config.COIN_NAME} ke ${eligible.length} orang` });
    return message.reply({ embeds: [embed] });
  }

  // ===================== DADU =====================
  if (command === 'dadu') {
    if (isDM) return message.reply('❌ Command ini hanya bisa di server Discord!');
    if (!user) return message.reply('❌ Kamu belum terdaftar!');
    const target = message.mentions.users.first();
    const bet = parseInt(args[1]);
    if (!target || isNaN(bet) || bet <= 0) return message.reply('❌ Format: `!dadu @user <taruhan>`');
    if (target.bot || target.id === message.author.id) return message.reply('❌ Target tidak valid!');
    if (user.balance < bet) return message.reply(`❌ Saldo tidak cukup! Saldo: **${user.balance.toLocaleString()} ${config.COIN_NAME}**`);

    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply(`❌ ${target.username} belum terdaftar!`);
    if (targetUser.balance < bet) return message.reply(`❌ ${target.username} tidak punya cukup saldo!`);

    const diceA = Math.floor(Math.random() * 6) + 1;
    const diceB = Math.floor(Math.random() * 6) + 1;
    const diceFaces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    let result, winner, loser, winnerUser, loserUser;
    if (diceA > diceB) {
      winner = message.author; winnerUser = user; loser = target; loserUser = targetUser;
    } else if (diceB > diceA) {
      winner = target; winnerUser = targetUser; loser = message.author; loserUser = user;
    } else {
      result = 'draw';
    }

    if (result !== 'draw') {
      winnerUser.balance += bet;
      loserUser.balance -= bet;
    }
    db.transactions.push({ type: 'dadu', playerA: message.author.id, playerB: target.id, bet, diceA, diceB, winner: result === 'draw' ? 'draw' : winner.id, timestamp: new Date().toISOString() });
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🎲 Adu Dadu!')
      .setColor(result === 'draw' ? config.COLOR_INFO : config.COLOR_SUCCESS)
      .addFields(
        { name: `${message.author.username}`, value: `${diceFaces[diceA]} **${diceA}**`, inline: true },
        { name: 'VS', value: '⚔️', inline: true },
        { name: `${target.username}`, value: `${diceFaces[diceB]} **${diceB}**`, inline: true },
      )
      .setDescription(result === 'draw' ? '🤝 **SERI!** Tidak ada yang menang!' : `🏆 **${winner.username}** MENANG **${bet.toLocaleString()} ${config.COIN_NAME}**!`);
    return message.reply({ embeds: [embed] });
  }

  // ===================== SLOT =====================
  if (command === 'slot') {
    if (!user) return message.reply('❌ Kamu belum terdaftar!');
    const bet = parseInt(args[0]);
    if (isNaN(bet) || bet <= 0) return message.reply('❌ Format: `!slot <taruhan>`');
    if (user.balance < bet) return message.reply(`❌ Saldo tidak cukup!`);

    const symbols = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣'];
    const spin = [0, 0, 0].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
    const line = spin.join(' | ');

    let multiplier = 0;
    if (spin[0] === spin[1] && spin[1] === spin[2]) {
      if (spin[0] === '💎') multiplier = 10;
      else if (spin[0] === '7️⃣') multiplier = 7;
      else if (spin[0] === '⭐') multiplier = 5;
      else multiplier = 3;
    } else if (spin[0] === spin[1] || spin[1] === spin[2] || spin[0] === spin[2]) {
      multiplier = 1.5;
    }

    const won = Math.floor(bet * multiplier);
    user.balance += won - bet;
    if (user.balance < 0) user.balance = 0;
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('🎰 SLOT MACHINE')
      .setColor(multiplier > 0 ? config.COLOR_SUCCESS : config.COLOR_ERROR)
      .setDescription(`**[ ${line} ]**`)
      .addFields(
        { name: 'Taruhan', value: `${bet.toLocaleString()} ${config.COIN_NAME}`, inline: true },
        { name: 'Hasil', value: multiplier > 0 ? `+${won.toLocaleString()} ${config.COIN_NAME} (x${multiplier})` : `Kalah`, inline: true },
        { name: 'Saldo Sekarang', value: `${user.balance.toLocaleString()} ${config.COIN_NAME}`, inline: true },
      );
    return message.reply({ embeds: [embed] });
  }

  // ===================== TOP LEADERBOARD =====================
  if (command === 'top') {
    const sorted = Object.values(db.users).sort((a, b) => b.balance - a.balance).slice(0, 10);
    const list = sorted.map((u, i) => `**${i + 1}.** ${u.discordTag || u.noHp} — **${u.balance.toLocaleString()} ${config.COIN_NAME}**`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('🏆 Leaderboard BFL Coin')
      .setColor(config.COLOR_MAIN)
      .setDescription(list || 'Belum ada data.')
      .setFooter({ text: 'Top 10 saldo tertinggi' });
    return message.reply({ embeds: [embed] });
  }

  // ===================== TOPUP (DM ONLY) =====================
  if (command === 'topup') {
    if (!isDM) return message.reply('⚠️ Topup hanya bisa dilakukan di **DM bot**!');
    if (!user) return message.reply('❌ Kamu belum terdaftar! Lakukan `!register <no_dana>` dulu.');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < config.MIN_TOPUP) return message.reply(`❌ Minimal topup adalah **Rp${config.MIN_TOPUP.toLocaleString()}**\nFormat: \`!topup <jumlah>\``);

    db.pendingTopup[message.author.id] = { amount, timestamp: new Date().toISOString(), status: 'pending' };
    saveDB(db);

    const embed = new EmbedBuilder()
      .setTitle('📥 Request Topup')
      .setColor(config.COLOR_INFO)
      .setDescription(`Silakan transfer **Rp${amount.toLocaleString()}** ke DANA berikut:`)
      .addFields(
        { name: '📱 No DANA Admin', value: `**${config.DANA_ADMIN}**`, inline: false },
        { name: '💰 Jumlah Transfer', value: `Rp${amount.toLocaleString()}`, inline: true },
        { name: '📝 Berita', value: `TOPUP-${message.author.id.slice(-4)}`, inline: true },
        { name: '⏳ Status', value: 'Menunggu konfirmasi admin (maks 1x24 jam)', inline: false },
      )
      .setFooter({ text: 'Screenshot bukti transfer dan kirim ke admin Discord!' });
    return message.reply({ embeds: [embed] });
  }

  // ===================== TARIK (DM ONLY) =====================
  if (command === 'tarik') {
    if (!isDM) return message.reply('⚠️ Tarik hanya bisa dilakukan di **DM bot**!');
    if (!user) return message.reply('❌ Kamu belum terdaftar!');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < config.MIN_TARIK) return message.reply(`❌ Minimal tarik adalah **Rp${config.MIN_TARIK.toLocaleString()}**`);
    if (user.balance < amount) return message.reply(`❌ Saldo tidak cukup! Saldo: **${user.balance.toLocaleString()} ${config.COIN_NAME}**`);

    user.balance -= amount;
    db.pendingTarik[message.author.id] = { amount, noHp: user.noHp, timestamp: new Date().toISOString(), status: 'pending' };
    saveDB(db);

    // Notif ke admin
    try {
      const adminUser = await client.users.fetch(config.ADMIN_ID);
      const notif = new EmbedBuilder()
        .setTitle('🔔 REQUEST TARIK BARU!')
        .setColor(0xFF6600)
        .addFields(
          { name: 'User', value: `${message.author.tag} (<@${message.author.id}>)`, inline: false },
          { name: 'No DANA Tujuan', value: user.noHp, inline: true },
          { name: 'Jumlah', value: `Rp${amount.toLocaleString()}`, inline: true },
          { name: 'Waktu', value: new Date().toLocaleString('id-ID'), inline: false },
          { name: '✅ Approve', value: `\`!approve ${message.author.id} ${amount}\``, inline: true },
          { name: '❌ Tolak', value: `\`!reject ${message.author.id}\``, inline: true },
        );
      await adminUser.send({ embeds: [notif] });
    } catch (e) { console.log('Gagal kirim notif admin:', e.message); }

    const embed = new EmbedBuilder()
      .setTitle('📤 Request Tarik Terkirim')
      .setColor(config.COLOR_INFO)
      .setDescription(`Permintaan tarik **Rp${amount.toLocaleString()}** telah dikirim ke admin.\nSaldo kamu dikurangi sementara sampai diproses.`)
      .addFields(
        { name: 'No DANA Tujuan', value: user.noHp, inline: true },
        { name: 'Saldo Sekarang', value: `${user.balance.toLocaleString()} ${config.COIN_NAME}`, inline: true },
        { name: '⏳ Estimasi', value: 'Diproses dalam 1x24 jam', inline: false }
      );
    return message.reply({ embeds: [embed] });
  }

  // ===================== ADMIN: APPROVE TOPUP =====================
  if (command === 'topupok') {
    if (message.author.id !== config.ADMIN_ID) return;
    const targetId = args[0];
    const amount = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!topupok <discordId> <jumlah>`');

    const targetUser = getUserByDiscordId(db, targetId);
    if (!targetUser) return message.reply('❌ User tidak ditemukan!');
    targetUser.balance += amount;
    delete db.pendingTopup[targetId];
    db.transactions.push({ type: 'topup', to: targetId, amount, approvedBy: message.author.id, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      const embed = new EmbedBuilder()
        .setTitle('✅ Topup Berhasil!')
        .setColor(config.COLOR_SUCCESS)
        .setDescription(`Topup **${amount.toLocaleString()} ${config.COIN_NAME}** berhasil dikreditkan!`)
        .addFields({ name: 'Saldo Baru', value: `${targetUser.balance.toLocaleString()} ${config.COIN_NAME}` });
      await u.send({ embeds: [embed] });
    } catch (e) {}

    return message.reply(`✅ Topup Rp${amount.toLocaleString()} untuk <@${targetId}> berhasil!`);
  }

  // ===================== ADMIN: APPROVE TARIK =====================
  if (command === 'approve') {
    if (message.author.id !== config.ADMIN_ID) return;
    const targetId = args[0];
    const amount = parseInt(args[1]);
    if (!targetId || isNaN(amount)) return message.reply('Format: `!approve <discordId> <jumlah>`');

    delete db.pendingTarik[targetId];
    db.transactions.push({ type: 'tarik', from: targetId, amount, approvedBy: message.author.id, timestamp: new Date().toISOString() });
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      const embed = new EmbedBuilder()
        .setTitle('✅ Tarik Berhasil Diproses!')
        .setColor(config.COLOR_SUCCESS)
        .setDescription(`Penarikan **Rp${amount.toLocaleString()}** ke DANA kamu sedang dikirim!`)
        .addFields({ name: '⏳ Estimasi tiba', value: 'Beberapa menit — 1 jam' });
      await u.send({ embeds: [embed] });
    } catch (e) {}
    return message.reply(`✅ Tarik Rp${amount.toLocaleString()} untuk <@${targetId}> disetujui!`);
  }

  // ===================== ADMIN: REJECT TARIK =====================
  if (command === 'reject') {
    if (message.author.id !== config.ADMIN_ID) return;
    const targetId = args[0];
    const pending = db.pendingTarik[targetId];
    if (!pending) return message.reply('❌ Tidak ada request tarik dari user ini.');

    const targetUser = getUserByDiscordId(db, targetId);
    if (targetUser) targetUser.balance += pending.amount; // kembalikan saldo
    delete db.pendingTarik[targetId];
    saveDB(db);

    try {
      const u = await client.users.fetch(targetId);
      await u.send(`❌ Request tarik **Rp${pending.amount.toLocaleString()}** kamu ditolak. Saldo dikembalikan. Hubungi admin untuk info lebih lanjut.`);
    } catch (e) {}
    return message.reply(`✅ Request tarik dari <@${targetId}> ditolak dan saldo dikembalikan.`);
  }

  // ===================== ADMIN: BERI KOIN =====================
  if (command === 'givecoin') {
    if (message.author.id !== config.ADMIN_ID) return;
    const target = message.mentions.users.first();
    const amount = parseInt(args[1]);
    if (!target || isNaN(amount)) return message.reply('Format: `!givecoin @user <jumlah>`');
    const targetUser = getUserByDiscordId(db, target.id);
    if (!targetUser) return message.reply('❌ User belum terdaftar!');
    targetUser.balance += amount;
    saveDB(db);
    return message.reply(`✅ Berhasil memberi ${amount.toLocaleString()} ${config.COIN_NAME} ke ${target.username}!`);
  }

  // ===================== ADMIN: CEK SEMUA USER =====================
  if (command === 'allusers') {
    if (message.author.id !== config.ADMIN_ID) return;
    const list = Object.values(db.users).map(u => `${u.discordTag || u.noHp}: **${u.balance.toLocaleString()}** ${config.COIN_NAME}`).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📋 Semua User BFL Coin')
      .setColor(config.COLOR_INFO)
      .setDescription(list || 'Belum ada user.');
    return message.reply({ embeds: [embed] });
  }
});

client.login(config.TOKEN);
N);
