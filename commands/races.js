const { SlashCommandBuilder } = require('discord.js');

function buildSlashCommand() {
    return new SlashCommandBuilder()
        .setName('races')
        .setDescription('Show ongoing races for categories configured in this channel')
        .setDMPermission(false);
}

module.exports.build = buildSlashCommand;
