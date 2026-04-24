const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildSlashCommand() {
    return new SlashCommandBuilder()
        .setName('rtclear')
        .setDescription('Clear all announces from a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Text channel in this server')
                .setRequired(true)
        );
}

module.exports.build = buildSlashCommand;
