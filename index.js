const discord = require('discord.js');
const fs = require('fs');
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

const client = new discord.Client();
client.login(config.token);

function getRace(race) {
    return new Promise(resolve => {
        getJSON('https://racetime.gg' + race.data_url, function(error, race) {
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
    let embed = new discord.MessageEmbed()
        .setColor('#26dd9a')
        .setTitle(race.category.name + ' ~ ' + race.goal.name)
        .setURL('https://racetime.gg' + race.url)
        .setDescription(race.status.help_text)
        .addField('Entrants', race.entrants_count + ' total, ' + race.entrants_count_inactive + ' inactive')
        .setFooter('racetime.gg', 'https://racetime.gg/icon.svg');
    if (race.category.image) {
        embed.setThumbnail(race.category.image);
    }
    if (started && race.opened_by) {
        embed.setAuthor(
            'Race room opened by ' + race.opened_by.full_name,
            race.opened_by.avatar ? race.opened_by.avatar : null
        );
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
        channel.send(embed).then(sentMessage => {
            resolve(sentMessage.id);
        }).catch(e => {
            console.error("error while sending announcement: " + e);
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
            raceMsg.edit(embed);
            resolve(raceMsg.id);
        }).catch(e => {
            console.error("error while updating discord announcement: " + e);
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
            console.error("error while removing discord announcement (", channel, "|", messageID, "): " + e);
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
            let ongoingRaceIndex = ongoingRaces.findIndex(ongoingRace => ongoingRace.name === entry.race);

            if (ongoingRaceIndex === -1) {
                for (let channelID of Object.keys(entry.announcementMsgs)) {
                    const channel = getChannelFromMention('<#' + channelID + '>');
                    if (channel)
                        removeRaceAnnouncement(channel, entry.announcementMsgs[channelID]);
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
            let stateObjectIndex = state.races.findIndex(trackedRace => trackedRace.race === race.name);

            let raceObj = {
                race: race.name,
                version: race.version,
            };

            // Ignore this race if it's already been processed and there are no new changes
            if (stateObjectIndex !== -1 && state.races[stateObjectIndex].version >= race.version) {
                continue;
            }

            if (stateObjectIndex !== -1 && Object.keys(state.races[stateObjectIndex].announcementMsgs).length > 0) {
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

client.once('ready', () => {
    console.log("Bot started!");
    cleanupState();
    getCurrentRaces();
    setInterval(cleanupState, 120000);
    setInterval(getCurrentRaces, 10000);
});

client.on('message', message => {
    if (!message.content.startsWith('!') || message.author.bot) {
        return;
    }

    const args = message.content.slice(1).split(/ +/);
    const command = args.shift().toLowerCase();
    if (message.member.hasPermission('MANAGE_GUILD')) {
        if (command === 'rtadd') {
            if (args.length < 2) {
                message.channel.send(
                    '!rtadd - Add a race announcer.\n'
                    + 'Usage: `!rtadd <channel> <category>`\n'
                    + '* `<channel>` - Text channel in this server\n'
                    + '* `<category>` - Category URL slug (e.g. "ootr", "gtasa" or "sm64"'
                );
            } else {
                const channel = getChannelFromMention(args[0]);
                if (!channel) {
                    message.channel.send('Channel not found.');
                } else {
                    getCategory(args[1], category => {
                        if (!category) {
                            message.channel.send('Unrecognised category slug.');
                        } else if (getAnnouncersForChannel(channel.id).indexOf(category.slug) !== -1) {
                            message.channel.send(
                                'I\'m already configured to announce '
                                + category.name
                                + ' races in ' + channel.toString()
                            );
                        } else {
                            state.announcers.push({
                                server: message.guild.id,
                                channel: channel.id,
                                category: category.slug
                            });
                            commitState();
                            message.channel.send(
                                'Added automatic race announcer for '
                                + category.name
                                + ' to ' + channel.toString()
                            );
                        }
                    });
                }
            }
        }
        if (message.channel.id === config.debugChannel) {
            if (command === 'rtlistall') {
                message.channel.send(
                    'Here are all the race categories I am currently announcing:'
                );
                state.announcers.forEach(item => {
                    let channel = getChannelFromMention('<#' + item.channel + '>');
                    getCategory(item.category, category => {
                        if (!category) return;
                        message.channel.send(
                            channel.guild.toString() + ' - '
                            + channel.toString() + ' - '
                            + category.name + ' (' + category.slug + ')'
                        );
                    });
                });
            }
        }
        if (command === 'rtclear') {
            if (args.length < 1) {
                message.channel.send(
                    '!rtclear - Clear all announces from a channel.\n'
                    + 'Usage: `!rtclear <channel>`\n'
                    + '* `<channel>` - Text channel in this server'
                );
            } else {
                const channel = getChannelFromMention(args[0]);
                if (!channel) {
                    message.channel.send('Channel not found.');
                } else {
                    getAnnouncersForChannel(channel.id);
                    state.announcers = state.announcers.filter(
                        item => item.channel !== channel.id
                    );
                    commitState();
                    message.channel.send(
                        'Cleared all race announcers for ' + channel.toString()
                    );
                }
            }
        }
        if (command === 'rtlist') {
            let announcers = getAnnouncersForServer(message.guild.id);
            if (announcers.length === 0) {
                message.channel.send(
                    'There are no race announcers on this server. '
                    + 'Use !rtadd to create one.'
                );
            } else {
                message.channel.send(
                    'Here are all the race categories I am currently announcing on this server:'
                );
                announcers.forEach(item => {
                    let channel = getChannelFromMention('<#' + item.channel + '>');
                    getCategory(item.category, category => {
                        message.channel.send(
                            channel.toString() + ' - '
                            + category.name + ' (' + category.slug + ')'
                        );
                    });
                });
            }
        }
    }
    if (command === 'races') {
        let categories = getAnnouncersForChannel(message.channel.id);
        if (categories.length === 0) return;
        let races = currentRaces.filter(
            race => categories.indexOf(race.category.slug) !== -1
        );
        if (races.length === 0) {
            message.channel.send('There are no races going on at the moment.');
        } else {
            races.forEach(raceSummary => {
                getRace(raceSummary).then(race => announceRace(race, message.channel, false));
            });
        }
    }
});
