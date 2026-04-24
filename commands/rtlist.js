const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildSlashCommand() {
    return new SlashCommandBuilder()
        .setName('rtlist')
        .setDescription('List all race categories currently being announced on this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false);
}

module.exports.build = buildSlashCommand;
