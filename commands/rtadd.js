const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildSlashCommand() {
    return new SlashCommandBuilder()
        .setName('rtadd')
        .setDescription('Add a race announcer')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Text channel in this server')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('category')
                .setDescription('Category URL slug (e.g. "ootr", "gtasa" or "sm64")')
                .setRequired(true)
        );
}

module.exports.build = buildSlashCommand;
