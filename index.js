const discord = require('discord.js');
const fs = require('fs');
const getJSON = require('get-json');
const jsonfile = require('jsonfile');

const configFile = './config/config.js';
const stateFile = './config/state.json';

jsonfile.spaces = 4;
if (!fs.existsSync(stateFile)) {
    jsonfile.writeFileSync(stateFile, {
        announcers: [],
        races: []
    }, {flag: 'wx'});
}

const config = require(configFile);
let currentRaces = [];
let state = jsonfile.readFileSync(stateFile);

const client = new discord.Client();
client.login(config.token);

/**
 * Announce a race to a channel.
 *
 * @param {object} race
 * @param {Channel} channel
 * @param {boolean} started
 */
function announceRace(race, channel, started) {
    getJSON('https://racetime.gg' + race.data_url, function(error, race) {
        if (error) {
            return console.error(error);
        }
        let embed = new discord.MessageEmbed()
            .setColor('#26dd9a')
            .setTitle(race.category.name + ' ~ ' + race.goal.name)
            .setURL('https://racetime.gg' + race.url)
            .setDescription(race.status.help_text)
            .addField('Entrants', race.entrants_count + ' total, ' + race.entrants_count_inactive + ' inactive')
            .setFooter('racetime.gg', 'https://racetime.gg/icon-512x512.png');
        if (race.category.image) {
            embed.setThumbnail('https://racetime.gg' + race.category.image);
        }
        if (started) {
            embed.setAuthor(
                'New race room opened by ' + race.opened_by.full_name,
                race.opened_by.avatar ? ('https://racetime.gg' + race.opened_by.avatar) : null
            );
        }
        channel.send(embed);
    });
}

/**
 * Clear out any old announced races from the state object.
 *
 * Races on racetime.gg can never last longer than 24 hours.
 */
function cleanupState() {
    const cutoff = new Date().getTime() - 86400000;
    state.races = state.races.filter(item => item.announced >= cutoff);
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
    getJSON('https://racetime.gg/' + slug.toLowerCase()  +'/data', function(error, response) {
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
    if (!mention) return;
    if (mention.startsWith('<#') && mention.endsWith('>')) {
        mention = mention.slice(2, -1);

        if (mention.startsWith('!')) {
            mention = mention.slice(1);
        }

        return client.channels.cache.get(mention);
    }
}

/**
 * Download current race list from the racetime.gg API
 *
 * Race information is stored in the `currentRaces` global variable.
 */
function getCurrentRaces() {
    getJSON('https://racetime.gg/races/data', function(error, response) {
        if (error) {
            return console.error(error);
        }
        currentRaces = response.races;
        currentRaces.filter(race => {
            return state.races.filter(item => item.race === race.name).length === 0;
        }).forEach(race => {
            getAnnouncersForCategory(race.category.slug).forEach(channelID => {
                const channel = getChannelFromMention('<#' + channelID + '>');
                if (channel) {
                    announceRace(race, channel, true);
                }
            });
            state.races.push({
                announced: new Date().getTime(),
                race: race.name,
            });
            commitState();
        });
    });
}

client.once('ready', () => {
    cleanupState();
    getCurrentRaces();
    setInterval(cleanupState, 3600000);
    setInterval(getCurrentRaces, 10000);
});

client.on('message', message => {
    if (!message.content.startsWith('!') || message.author.bot) {
        return;
    }

    const args = message.content.slice(1).split(/ +/);
    const command = args.shift().toLowerCase();
    if (message.member.hasPermission('ADMINISTRATOR')) {
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
            races.forEach(race => {
                announceRace(race, message.channel, false);
            });
        }
    }
});
