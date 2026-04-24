const { Client, EmbedBuilder, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const getJSON = require('get-json');
const jsonfile = require('jsonfile');

const configFile = './config/config.js';
const stateFile = './config/state.json';

jsonfile.spaces = 4;

let state = {
    announcers: [],
    races: []
};

if (!fs.existsSync(stateFile)) {
    jsonfile.writeFileSync(stateFile, state);
} else {
    state = jsonfile.readFileSync(stateFile);
    let now = new Date().toISOString().replace(/:/g, '');
    jsonfile.writeFileSync('./config/state-' + now + '.json', state);
}

const config = require(configFile);
let currentRaces = [];

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Message, Partials.Channel],
    restTimeOffset: 1000
  });
client.login(config.token);

function getRace(race) {
    return new Promise(resolve => {
        getJSON('https://racetime.gg' + race.data_url, function (error, race) {
            if (error) {
                console.error(error);
                resolve(null);
            } else {
                resolve(race);
            }
        })
    })
}

function createEmbed(race, started) {
    let embed = new EmbedBuilder()
        .setColor('#26dd9a')
        .setTitle(race.category.name + ' ~ ' + race.goal.name)
        .setURL('https://racetime.gg' + race.url)
        .setDescription(race.status.help_text)
        .addFields(
            {name: 'Entrants', value: race.entrants_count + ' total, ' + race.entrants_count_inactive + ' inactive'},
        )
        .setFooter({ "text": 'racetime.gg', "iconURL": 'https://racetime.gg/apple-touch-icon.png'});
    if (race.category.image) {
        embed.setThumbnail(race.category.image);
    }
    if (started && race.opened_by) {
        embed.setAuthor({
            "name": 'Race room opened by ' + race.opened_by.full_name,
            "iconURL": race.opened_by.avatar ? race.opened_by.avatar : null
        });
    }
    return embed;
}

/**
 * Announce a race to a channel.
 *
 * @param {object} race
 * @param {Channel} channel
 * @param {boolean} started
 */
function announceRace(race, channel, started) {
    return new Promise(resolve => {
        let embed = createEmbed(race, started);
        channel.send({embeds: [embed]}).then(sentMessage => {
            resolve(sentMessage.id);
        }).catch(e => {
            console.error("error while sending announcement to channel", channel.name, "in", channel.guild.name, ":", e);
            resolve(null);
        });
    });
}

/**
 * Edits a race announcement in a race channel
 *
 * @param {object} race
 * @param {Channel} channel
 * @param {string} messageID
 */
function editRaceAnnouncement(race, channel, messageID) {
    return new Promise(resolve => {
        let embed = createEmbed(race, true);
        channel.messages.fetch(messageID).then(raceMsg => {
            raceMsg.edit({embeds: [embed]});
            resolve(raceMsg.id);
        }).catch(e => {
            console.error("error while updating discord announcement in channel", channel.name, "from", channel.guild.name, ":", e);
            resolve(null);
        });
    });
}

/**
 * Removes the discord announcements in every channel listening to the category
 *
 * @param {Channel} channel
 * @param {string} messageID
 * @param {boolean} retry
 */
function removeRaceAnnouncement(channel, messageID, retry = false) {
    channel.messages.fetch(messageID).then(raceMsg => {
        raceMsg.delete();
    }).catch(e => {
        if (retry) {
            console.error("error while removing discord announcement (", channel, "|", messageID, "|", "in", channel.guild.name, "): " + e);
        }
        else {
            // attempt deletion again 10 seconds later
            setTimeout(() => removeRaceAnnouncement(channel, messageID, true), 10000);
        }
    });
}


/**
 * Clear out any old announced races from the state object.
 *
 * Races on racetime.gg can never last longer than 24 hours.
 */
function cleanupState() {
    getJSON('https://racetime.gg/races/data', async function (error, response) {
        if (error) {
            return console.error(error);
        }
        let ongoingRaces = response.races;

        for (const [index, entry] of state.races.entries()) {
            if (!entry)
                return;

            let ongoingRaceIndex = ongoingRaces.findIndex(ongoingRace => ongoingRace && ongoingRace.name === entry.race);

            if (ongoingRaceIndex === -1) {
                if (entry && "announcementMsgs" in entry) {
                    for (let channelID of Object.keys(entry.announcementMsgs)) {
                        const channel = getChannelFromMention('<#' + channelID + '>');
                        if (channel)
                            removeRaceAnnouncement(channel, entry.announcementMsgs[channelID]);
                    }
                }
                state.races.splice(index, 1)
            }
        }
    });
    commitState();
}

/**
 * Write current state object to file.
 */
function commitState() {
    jsonfile.writeFile(stateFile, state);
}

/**
 * Return array of category slugs where race announcers exist for the given
 * channel ID.
 *
 * @param channel
 * @returns {*}
 */
function getAnnouncersForChannel(channel) {
    return state.announcers
        .filter(item => item.channel === channel)
        .map(item => item.category);
}

/**
 * Return array of channel IDs where race announcers exist for the given
 * category slug.
 *
 * @param category
 * @returns {*}
 */
function getAnnouncersForCategory(category) {
    return state.announcers
        .filter(item => item.category === category)
        .map(item => item.channel);
}

/**
 * Return all announcers for the given server/guild ID.
 *
 * @param server
 * @returns {*}
 */
function getAnnouncersForServer(server) {
    return state.announcers.filter(item => item.server === server);
}

/**
 * Retrieve a racetime.gg category from its slug, invoking callback with an
 * object containing the category data.
 *
 * @param slug
 * @param callback
 */
function getCategory(slug, callback) {
    if (typeof slug !== 'string' || !slug.match(/^[A-Za-z0-9\-_]+$/)) {
        callback();
        return;
    }
    getJSON('https://racetime.gg/' + slug.toLowerCase() + '/data', function (error, response) {
        if (error) {
            callback();
        }
        callback(response);
    });
}

/**
 * Retrieve a Discord channel from a string mention tag.
 *
 * @param mention
 * @returns {Channel}
 */
function getChannelFromMention(mention) {
    if (mention && mention.startsWith('<#') && mention.endsWith('>')) {
        mention = mention.slice(2, -1);

        if (mention.startsWith('!')) {
            mention = mention.slice(1);
        }

        return client.channels.cache.get(mention);
    }
    return null;
}

/**
 * Download current race list from the racetime.gg API
 *
 * Race information is stored in the `currentRaces` global variable.
 */
function getCurrentRaces() {
    getJSON('https://racetime.gg/races/data', async function (error, response) {
        if (error) {
            return console.error(error);
        }
        currentRaces = response.races;
        for (let raceSummary of currentRaces) {
            let race = await getRace(raceSummary);
            if (!race || 'name' in race === false)
                return;

            let stateObjectIndex = state.races.findIndex(trackedRace => trackedRace && trackedRace.race === race.name);

            let raceObj = {
                race: race.name,
                version: race.version,
            };

            // Ignore this race if it's already been processed and there are no new changes
            if (stateObjectIndex !== -1 && state.races[stateObjectIndex].version && state.races[stateObjectIndex].version >= race.version) {
                continue;
            }

            if (stateObjectIndex !== -1 && state.races[stateObjectIndex].announcementMsgs && Object.keys(state.races[stateObjectIndex].announcementMsgs).length > 0) {
                raceObj.announcementMsgs = state.races[stateObjectIndex].announcementMsgs
            } else {
                raceObj.announcementMsgs = {};
            }

            let categoryAnnouncers = getAnnouncersForCategory(race.category.slug);
            for (let channelID of categoryAnnouncers) {
                const channel = getChannelFromMention('<#' + channelID + '>');
                if (channel) {
                    let annoucementID;

                    if (raceObj.announcementMsgs && channelID in raceObj.announcementMsgs) {
                        annoucementID = await editRaceAnnouncement(race, channel, raceObj.announcementMsgs[channelID]);
                        if (annoucementID == null) {
                            delete raceObj.announcementMsgs[channelID];
                        }
                    }
                    else {
                        annoucementID = await announceRace(race, channel, true);
                        if (annoucementID != null) {
                            raceObj.announcementMsgs[channelID] = annoucementID;
                        }
                    }
                }
            }

            if (stateObjectIndex !== -1) {
                state.races[stateObjectIndex] = raceObj;
            } else {
                state.races.push(raceObj);
            }
            commitState();
        }
    });
}

client.once('ready', async () => {
    console.log("Bot started!");

    // Register Slash Commands
    const commands = [];
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));


    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if ('build' in command) {
            commands.push(command.build());
        }
    }

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log(`Started refreshing ${commands.length} application commands.`);
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log(`Successfully reloaded ${commands.length} application commands.`);
    } catch (error) {
        console.error(error);
    }

    cleanupState();
    getCurrentRaces();
    setInterval(cleanupState, 120000);
    setInterval(getCurrentRaces, 10000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, guildId, channelId } = interaction;

    if (commandName === 'rtadd') {
        const channel = options.getChannel('channel');
        const categorySlug = options.getString('category');

        if (!channel) {
            return interaction.reply({ content: 'Channel not found.', ephemeral: true });
        }

        getCategory(categorySlug, async category => {
            if (!category) {
                await interaction.reply({ content: 'Unrecognised category slug.', ephemeral: true });
            } else if (getAnnouncersForChannel(channel.id).indexOf(category.slug) !== -1) {
                await interaction.reply({
                    content: `I'm already configured to announce ${category.name} races in ${channel.toString()}`,
                    ephemeral: true
                });
            } else {
                state.announcers.push({
                    server: guildId,
                    channel: channel.id,
                    category: category.slug
                });
                commitState();
                await interaction.reply({
                    content: `Added automatic race announcer for ${category.name} to ${channel.toString()}`
                });
            }
        });
    }

    if (commandName === 'rtclear') {
        const channel = options.getChannel('channel');
        if (!channel) {
            return interaction.reply({ content: 'Channel not found.', ephemeral: true });
        }

        state.announcers = state.announcers.filter(
            item => item.channel !== channel.id
        );
        commitState();
        await interaction.reply({
            content: `Cleared all race announcers for ${channel.toString()}`
        });
    }

    if (commandName === 'rtlist') {
        let announcers = getAnnouncersForServer(guildId);
        if (announcers.length === 0) {
            return interaction.reply({
                content: 'There are no race announcers on this server. Use /rtadd to create one.'
            });
        } else {
            let response = 'Here are all the race categories I am currently announcing on this server:';
            let details = [];
            for (const item of announcers) {
                const channel = getChannelFromMention('<#' + item.channel + '>');
                const category = await new Promise(resolve => getCategory(item.category, resolve));
                if (channel && category) {
                    details.push(`${channel.toString()} - ${category.name} (${category.slug})`);
                }
            }
            await interaction.reply({ content: response + '\n' + details.join('\n') });
        }
    }

    if (commandName === 'rtlistall') {
        if (interaction.channelId !== config.debugChannel) {
            return interaction.reply({ content: 'This command can only be used in the debug channel.', ephemeral: true });
        }

        let response = 'Here are all the race categories I am currently announcing:';
        let details = [];
        for (const item of state.announcers) {
            const channel = getChannelFromMention('<#' + item.channel + '>');
            const category = await new Promise(resolve => getCategory(item.category, resolve));
            if (channel && category) {
                details.push(`${channel.guild.toString()} - ${channel.toString()} - ${category.name} (${category.slug})`);
            }
        }
        await interaction.reply({ content: response + '\n' + details.join('\n') });
    }

    if (commandName === 'races') {
        let categories = getAnnouncersForChannel(channelId);
        if (categories.length === 0) {
            return interaction.reply({ content: 'This channel is not configured to announce any race categories.', ephemeral: true });
        }
        let races = currentRaces.filter(
            race => categories.indexOf(race.category.slug) !== -1
        );
        if (races.length === 0) {
            await interaction.reply({ content: 'There are no races going on at the moment.' });
        } else {
            await interaction.reply({ content: 'Fetching current races...' });
            for (const raceSummary of races) {
                const race = await getRace(raceSummary);
                if (race) {
                    await announceRace(race, interaction.channel, false);
                }
            }
        }
    }
});
