const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, 
    TextInputStyle, Partials 
} = require('discord.js');
const mongoose = require('mongoose');
require('dotenv').config();

// Khởi tạo Client với đầy đủ quyền hạn
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel]
});

const ADMIN_ROLE_ID = "1465374336214106237"; 
const CURRENCY_NAME = "Verdict Cash 💰";

// ==========================================
// 1. DATABASE MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    discordId: { type: String, unique: true },
    balance: { type: Number, default: 0 },
    totalBet: { type: Number, default: 0 }
}));

const Match = mongoose.model('Match', new mongoose.Schema({
    matchId: String,
    team1: String, team2: String,
    h1: Number, h2: Number,
    status: { type: String, default: 'OPEN' },
    bets: [{ userId: String, team: String, amount: Number, timestamp: { type: Date, default: Date.now } }]
}));

// Kết nối MongoDB với cơ chế báo lỗi chi tiết
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ [DATABASE] Kết nối thành công!'))
    .catch(err => console.error('❌ [DATABASE] Lỗi kết nối:', err));

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================
const formatMoney = (amount) => amount.toLocaleString('vi-VN');

// ==========================================
// 3. XỬ LÝ LỆNH (COMMANDS)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // --- LỆNH GIÚP ĐỠ ---
        if (command === 'help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('📚 DANH SÁCH LỆNH BOT BETTING')
                .setColor('#3498DB')
                .addFields(
                    { name: '👤 Người chơi', value: '`!me`: Xem tiền\n`!top`: Đại gia\n`!ti-so`: Xem kèo đang mở' },
                    { name: '🛠️ Admin', value: '`!keo [Đội1] [Đội2] [H1] [H2]`: Tạo kèo\n`!win [ID] [Tỉ số]`: Chốt kết quả\n`!nap @user [Số tiền]`: Nạp tiền' }
                );
            message.channel.send({ embeds: [helpEmbed] });
        }

        // --- TẠO KÈO (ADMIN) ---
        if (command === 'keo') {
            if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
            const [t1, t2, h1, h2] = args;
            if (!t1 || !t2 || h1 === undefined || h2 === undefined) 
                return message.reply("⚠️ Sai cú pháp! VD: `!keo MU MC 0 0.5` (MU chấp 0, MC chấp nửa trái)");

            const matchId = "M" + Math.floor(1000 + Math.random() * 9000);
            await Match.create({ matchId, team1: t1, team2: t2, h1: parseFloat(h1), h2: parseFloat(h2) });

            const embed = new EmbedBuilder()
                .setTitle(`🏟️ KÈO MỚI ĐÃ LÊN | ID: ${matchId}`)
                .setDescription(`Hãy chọn đội bạn tin tưởng. Tỉ lệ chấp đã được tính toán!`)
                .setColor('#F39C12')
                .addFields(
                    { name: `🔵 ${t1}`, value: `Chấp: **${h1}**`, inline: true },
                    { name: 'VS', value: '⚡', inline: true },
                    { name: `🔴 ${t2}`, value: `Chấp: **${h2}**`, inline: true }
                )
                .setFooter({ text: 'Nhấn nút bên dưới để đặt cược' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`bet_1_${matchId}`).setLabel(`Cược ${t1}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`bet_2_${matchId}`).setLabel(`Cược ${t2}`).setStyle(ButtonStyle.Danger)
            );

            await message.channel.send({ embeds: [embed], components: [row] });
        }

        // --- XỬ LÝ THẮNG/THUA (ADMIN) ---
        if (command === 'win') {
            if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
            const [mid, score] = args;
            if (!mid || !score || !score.includes('-')) return message.reply("⚠️ VD: `!win M1234 2-1`.");

            const match = await Match.findOne({ matchId: mid, status: 'OPEN' });
            if (!match) return message.reply("❌ Không tìm thấy trận đấu này!");

            const [s1, s2] = score.split('-').map(Number);
            const r1 = s1 + match.h1;
            const r2 = s2 + match.h2;

            let winner = "", winKey = "";
            if (r1 > r2) { winner = match.team1; winKey = "1"; }
            else if (r2 > r1) { winner = match.team2; winKey = "2"; }
            else { winner = "Hòa (Hoàn tiền)"; winKey = "draw"; }

            let totalPaid = 0;
            for (const b of match.bets) {
                let u = await User.findOneAndUpdate({ discordId: b.userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, new: true });
                if (winKey === "draw") {
                    u.balance += b.amount;
                } else if (b.team === winKey) {
                    const winAmt = b.amount * 2;
                    u.balance += winAmt;
                    totalPaid += winAmt;
                }
                await u.save();
            }

            match.status = 'CLOSED';
            await match.save();

            const resEmbed = new EmbedBuilder()
                .setTitle(`🏁 KẾT QUẢ TRẬN ${mid}`)
                .setColor('#2ECC71')
                .addFields(
                    { name: 'Tỉ số thực', value: `**${score}**`, inline: true },
                    { name: 'Thắng kèo', value: `🎊 **${winner}**`, inline: true },
                    { name: 'Tổng chi trả', value: `💸 ${formatMoney(totalPaid)} ${CURRENCY_NAME}` }
                );
            message.channel.send({ embeds: [resEmbed] });
        }

        // --- XEM SỐ DƯ ---
        if (command === 'me') {
            const u = await User.findOne({ discordId: message.author.id });
            message.reply(`💰 Số dư của bạn: **${formatMoney(u ? u.balance : 0)}** ${CURRENCY_NAME}`);
        }

        // --- NẠP TIỀN (ADMIN) ---
        if (command === 'nap') {
            if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) return;
            const target = message.mentions.users.first();
            const amt = parseInt(args[1]);
            if (!target || isNaN(amt)) return message.reply("⚠️ `!nap @user 10000`.");

            await User.findOneAndUpdate({ discordId: target.id }, { $inc: { balance: amt } }, { upsert: true });
            message.reply(`✅ Đã nạp **${formatMoney(amt)}** cho ${target.username}.`);
        }

    } catch (error) {
        console.error("Lỗi thực thi lệnh:", error);
        message.reply("❌ Có lỗi xảy ra khi xử lý lệnh!");
    }
});

// ==========================================
// 4. INTERACTION (BUTTONS & MODALS)
// ==========================================
client.on('interactionCreate', async (i) => {
    try {
        if (i.isButton() && i.customId.startsWith('bet_')) {
            const [_, key, mid] = i.customId.split('_');
            const m = await Match.findOne({ matchId: mid, status: 'OPEN' });
            if (!m) return i.reply({ content: "⏳ Trận đấu đã đóng cược!", ephemeral: true });

            const modal = new ModalBuilder().setCustomId(`modal_${key}_${mid}`).setTitle('XÁC NHẬN ĐẶT CƯỢC');
            const input = new TextInputBuilder()
                .setCustomId('amt')
                .setLabel("Nhập số tiền muốn cược:")
                .setPlaceholder("Ví dụ: 50000")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
            
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await i.showModal(modal);
        }

        if (i.isModalSubmit() && i.customId.startsWith('modal_')) {
            const [_, key, mid] = i.customId.split('_');
            const amt = parseInt(i.fields.getTextInputValue('amt'));
            
            if (isNaN(amt) || amt < 1000) return i.reply({ content: "❌ Số tiền cược tối thiểu là 1.000!", ephemeral: true });

            let u = await User.findOne({ discordId: i.user.id });
            if (!u || u.balance < amt) return i.reply({ content: `❌ Bạn không đủ tiền! (Số dư: ${formatMoney(u ? u.balance : 0)})`, ephemeral: true });

            const m = await Match.findOne({ matchId: mid, status: 'OPEN' });
            if (!m) return i.reply({ content: "❌ Trận đấu vừa mới đóng!", ephemeral: true });

            u.balance -= amt;
            u.totalBet += amt;
            await u.save();

            m.bets.push({ userId: i.user.id, team: key, amount: amt });
            await m.save();

            const teamName = key === "1" ? m.team1 : m.team2;
            await i.reply({ content: `✅ Đã chốt: **${formatMoney(amt)}** vào cửa **${teamName}**. Chúc bạn may mắn!`, ephemeral: true });
        }
    } catch (err) {
        console.error("Lỗi Interaction:", err);
    }
});

client.login(process.env.TOKEN);
