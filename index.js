const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle 
} = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

const ADMIN_ROLE_ID ="1490944152610013357"; 

// ==========================================
// 1. CẤU TRÚC DATABASE (MONGODB)
// ==========================================
const UserSchema = new mongoose.Schema({
    discordId: String,
    balance: { type: Number, default: 0 }
});
const User = mongoose.model('User', UserSchema);

const MatchSchema = new mongoose.Schema({
    matchId: String,
    team1: String, team2: String,
    h1: Number, h2: Number,
    status: { type: String, default: 'OPEN' }, // OPEN, CLOSED
    bets: [{ userId: String, team: String, amount: Number }]
});
const Match = mongoose.model('Match', MatchSchema);

// Kết nối Database
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ Đã kết nối Database MongoDB')).catch(err => console.error(err));

client.once('ready', () => console.log(`🚀 Bot Betting Ultimate đã sẵn sàng: ${client.user.tag}`));

// ==========================================
// 2. XỬ LÝ LỆNH TỪ ADMIN & NGƯỜI CHƠI
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const args = message.content.trim().split(/ +/);
    const command = args[0].toLowerCase();

    // --- TẠO KÈO MỚI --- (!keo MU Chelsea 0 0.5)
    if (command === '!keo') {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
        const [_, t1, t2, h1, h2] = args;
        if (!t1 || !t2 || h1 === undefined || h2 === undefined) return message.reply("⚠️ HD: `!keo [Đội 1] [Đội 2] [Chấp 1] [Chấp 2]`");

        const matchId = "M" + Math.floor(Math.random() * 10000); // Tạo mã trận ngẫu nhiên
        
        await Match.create({ matchId, team1: t1, team2: t2, h1: parseFloat(h1), h2: parseFloat(h2) });

        const embed = new EmbedBuilder()
            .setTitle(`🏟️ TRẬN ĐẤU MỚI | MÃ: ${matchId}`)
            .setColor('#E67E22')
            .setDescription('Trận đấu đã mở! Hãy kiểm tra kỹ tỉ lệ chấp trước khi vào tiền.')
            .addFields(
                { name: `🔵 ${t1}`, value: `Chấp: **${h1}**`, inline: true },
                { name: 'VS', value: '⚡', inline: true },
                { name: `🔴 ${t2}`, value: `Chấp: **${h2}**`, inline: true }
            )
            .setImage('https://i.imgur.com/B9B9z0G.png');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bet_1_${matchId}`).setLabel(`Cược ${t1}`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bet_2_${matchId}`).setLabel(`Cược ${t2}`).setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- CHỐT KẾT QUẢ --- (!win M1234 3-0)
    if (command === '!win') {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
        const matchId = args[1];
        const score = args[2];

        if (!matchId || !score || !score.includes('-')) return message.reply("⚠️ HD: `!win [Mã Trận] [Tỉ số]`. Ví dụ: `!win M1234 3-0`");

        const match = await Match.findOne({ matchId, status: 'OPEN' });
        if (!match) return message.reply("❌ Không tìm thấy trận đấu này hoặc đã đóng cược!");

        const [s1, s2] = score.split('-').map(Number);
        const finalScore1 = s1 + match.h1;
        const finalScore2 = s2 + match.h2;

        let winnerTeam = "", winKey = "";
        if (finalScore1 > finalScore2) { winnerTeam = match.team1; winKey = "1"; }
        else if (finalScore2 > finalScore1) { winnerTeam = match.team2; winKey = "2"; }
        else { winnerTeam = "Hòa (Hoàn tiền)"; winKey = "draw"; }

        // Trả thưởng
        let totalPayout = 0;
        for (const bet of match.bets) {
            let userData = await User.findOne({ discordId: bet.userId });
            if (!userData) continue;

            if (winKey === "draw") {
                userData.balance += bet.amount; // Hoàn gốc
            } else if (bet.team === winKey) {
                const prize = bet.amount * 2;
                userData.balance += prize; // Thắng x2
                totalPayout += prize;
                client.users.send(bet.userId, `🎉 **${winnerTeam}** thắng kèo! Bạn nhận được **${prize.toLocaleString()}** từ trận \`${matchId}\``).catch(() => {});
            }
            await userData.save();
        }

        match.status = 'CLOSED';
        await match.save();

        const resultEmbed = new EmbedBuilder()
            .setTitle(`🏆 KẾT QUẢ TRẬN: ${matchId}`)
            .setColor('#2ECC71')
            .addFields(
                { name: 'Tỉ số thực tế', value: `**${s1} - ${s2}**`, inline: true },
                { name: 'Tỉ số sau chấp', value: `**${finalScore1} - ${finalScore2}**`, inline: true },
                { name: 'Đội thắng kèo', value: `🔥 **${winnerTeam}**` }
            )
            .setFooter({ text: `Hệ thống đã tự động thanh toán: ${totalPayout.toLocaleString()}` });

        await message.channel.send({ embeds: [resultEmbed] });
    }

    // --- NẠP TIỀN & BẢNG XẾP HẠNG ---
    if (command === '!nap') {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
        const target = message.mentions.users.first() || { id: args[1] };
        const amount = parseInt(args[2]);
        if (!target.id || isNaN(amount)) return message.reply("HD: `!nap @user 50000`.");
        
        let userData = await User.findOneAndUpdate(
            { discordId: target.id }, 
            { $inc: { balance: amount } }, 
            { new: true, upsert: true }
        );
        message.reply(`💳 Đã nạp **${amount.toLocaleString()}** cho <@${target.id}>. Số dư: **${userData.balance.toLocaleString()}**`);
    }

    if (command === '!top') {
        const topUsers = await User.find().sort({ balance: -1 }).limit(5);
        if (topUsers.length === 0) return message.reply("Chưa có ai trong danh sách.");

        let leaderboard = topUsers.map((u, i) => `**#${i+1}** <@${u.discordId}>: ${u.balance.toLocaleString()} 💰`).join('\n');
        const topEmbed = new EmbedBuilder().setTitle('💎 BẢNG XẾP HẠNG ĐẠI GIA').setDescription(leaderboard).setColor('#F1C40F');
        message.channel.send({ embeds: [topEmbed] });
    }
});

// ==========================================
// 3. XỬ LÝ NÚT BẤM & FORM NHẬP TIỀN
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('bet_')) {
        const [_, teamKey, matchId] = interaction.customId.split('_');
        
        const match = await Match.findOne({ matchId, status: 'OPEN' });
        if (!match) return interaction.reply({ content: "⏳ Trận đấu này đã đóng hoặc không tồn tại!", ephemeral: true });

        const teamName = teamKey === "1" ? match.team1 : match.team2;

        const modal = new ModalBuilder().setCustomId(`modal_${teamKey}_${matchId}`).setTitle(`Cược: ${teamName}`);
        const input = new TextInputBuilder().setCustomId('amt').setLabel("Số tiền cược (Viết liền, VD: 10000):").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
        const [_, teamKey, matchId] = interaction.customId.split('_');
        const amount = parseInt(interaction.fields.getTextInputValue('amt'));
        const uid = interaction.user.id;

        if (isNaN(amount) || amount <= 0) return interaction.reply({ content: "❌ Số tiền không hợp lệ!", ephemeral: true });

        // Lấy thông tin user từ DB
        let userData = await User.findOne({ discordId: uid });
        if (!userData || userData.balance < amount) {
            return interaction.reply({ content: `❌ Bạn không đủ tiền! Số dư: **${userData ? userData.balance.toLocaleString() : 0}**`, ephemeral: true });
        }

        const match = await Match.findOne({ matchId, status: 'OPEN' });
        if (!match) return interaction.reply({ content: "⏳ Trận đấu đã bị khóa trước khi bạn đặt cược!", ephemeral: true });

        // Trừ tiền & Lưu vé cược
        userData.balance -= amount;
        await userData.save();

        match.bets.push({ userId: uid, team: teamKey, amount: amount });
        await match.save();

        const teamName = teamKey === "1" ? match.team1 : match.team2;

        // Báo thành công
        await interaction.reply({ content: `✅ Chốt đơn! Cược **${amount.toLocaleString()}** vào **${teamName}** (Mã: ${matchId}).`, ephemeral: true });
        
        // Gửi vé DM
        const receipt = new EmbedBuilder()
            .setTitle('🧾 BIÊN LAI ĐIỆN TỬ')
            .setColor('#3498DB')
            .addFields(
                { name: 'Mã Trận', value: `\`${matchId}\``, inline: true },
                { name: 'Đội', value: `**${teamName}**`, inline: true },
                { name: 'Số Tiền', value: `**${amount.toLocaleString()}** 💰`, inline: false },
                { name: 'Số dư hiện tại', value: `**${userData.balance.toLocaleString()}**`, inline: false }
            )
            .setFooter({ text: 'Chúc bạn may mắn!' });
        await interaction.user.send({ embeds: [receipt] }).catch(() => {});
    }
});

client.login(process.env.TOKEN);
