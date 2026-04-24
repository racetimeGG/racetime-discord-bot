const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildSlashCommand() {
    return new SlashCommandBuilder()
        .setName('rtlistall')
        .setDescription('List all race categories I am currently announcing (Admin only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false);
}

module.exports.build = buildSlashCommand;
