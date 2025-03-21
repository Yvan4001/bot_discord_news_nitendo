import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } from 'discord.js';
import { Routes, ApplicationCommandOptionType } from 'discord-api-types/v10';
import { REST } from '@discordjs/rest';
import axios from 'axios';
import { load } from 'cheerio';
import dotenv from 'dotenv';
import Bottleneck from 'bottleneck';

// Initialize environment variables
dotenv.config();
const { BOT_TOKEN, CLIENT_ID } = process.env;

// Create a rate limiter: 30 requests per minute (2000ms between each request)
const limiter = new Bottleneck({
    minTime: 2000,  // Minimum time between requests (2 seconds)
    maxConcurrent: 1, // Process only one request at a time
    reservoir: 30,  // 30 requests
    reservoirRefreshAmount: 30,  // Refill 30 tokens
    reservoirRefreshInterval: 60 * 1000  // Refill every 60 seconds (1 minute)
});

// Wrap axios with the rate limiter
const limitedAxios = {
    get: limiter.wrap(axios.get)
};

// Initialize Discord client
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Nintendo news page URL
const NINTENDO_NEWS_URL = 'https://www.nintendo.com/us/whatsnew/';
// List of channels the bot can create and use
const ALLOWED_CHANNEL_NAMES = ['nintendo-news', 'switch-updates', 'gaming-news'];

// Helper function to fetch article details
async function fetchArticleDetails (url) {
    try {
        const response = await limitedAxios.get(url);
        const $ = load(response.data);

        // Try to find the main image
        let imageUrl = $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('.article-header img').attr('src') ||
            $('.article-content img').first().attr('src') ||
            $('img').first().attr('src');

        // Try to find a better description
        let description = $('meta[property="og:description"]').attr('content') ||
            $('meta[name="description"]').attr('content') ||
            $('.article-content p').first().text().trim() ||
            '';

        return {
            imageUrl: imageUrl || '',
            description: description || 'Nintendo news update'
        };
    } catch (error) {
        console.error(`Error fetching article details from ${url}:`, error);
        return { imageUrl: '', description: 'Nintendo news update' };
    }
}

// Function to fetch and parse Nintendo news
async function fetchNintendoNews (limit = 5) {
    try {
        console.log(`Fetching news from ${NINTENDO_NEWS_URL}...`);
        const response = await limitedAxios.get(NINTENDO_NEWS_URL);
        const $ = load(response.data);
        const newsItems = [];

        console.log('Parsing HTML content...');

        // Updated selectors based on current Nintendo website structure
        const potentialSelectors = [
            '.WhatIsNewPage-module__item',
            '.news-item',
            '.grid-item',
            '.nw-c-NewsItem',
            'article',
            '.card',
            '.link-block',
            'li.news-list-item',
            '.NintendoCard-module__main',
            '.COMPT-module__tile',
            '.WhatsNewHighlightModule-module__tile'
        ];

        let selectedSelector = '';
        let itemsFound = 0;

        // Find which selector works with the current page structure
        for (const selector of potentialSelectors) {
            itemsFound = $(selector).length;
            console.log(`Selector ${selector}: found ${itemsFound} items`);
            if (itemsFound > 0) {
                selectedSelector = selector;
                break;
            }
        }

        // Find all images on the page that might be news thumbnails
        const allImages = [];
        $('img').each((i, img) => {
            const $img = $(img);
            const src = $img.attr('src');
            const alt = $img.attr('alt') || '';

            if (src && (
                alt.toLowerCase().includes('news') ||
                $img.parent().text().toLowerCase().includes('news') ||
                src.toLowerCase().includes('news')
            )) {
                allImages.push({
                    src: src.startsWith('/') ? `https://www.nintendo.com${src}` : src,
                    alt: alt
                });
            }
        });

        // Fallback method if no selector worked
        if (!selectedSelector) {
            console.log('No matching selector found for news items, using fallback method');

            // Find all links that might be news items
            const newsLinks = [];

            $('a').each((i, el) => {
                const $el = $(el);
                const text = $el.text().trim();
                const link = $el.attr('href');

                // Check if this looks like the news format we're seeing
                if (text && link && text.includes('Read more')) {
                    const rawTitle = text.replace('Read more', '').trim();

                    // Parse date and title from the format "MM/DD/YYTitle"
                    let date = '';
                    let title = rawTitle;

                    // Extract date using regex
                    const dateMatch = rawTitle.match(/^(\d{2}\/\d{2}\/\d{2})/);
                    if (dateMatch) {
                        date = dateMatch[0];
                        title = rawTitle.substring(date.length).trim();
                    }

                    console.log(`Found news item: Date=${date}, Title=${title}`);

                    // Find image - check parent elements for images
                    let imageUrl = '';
                    let parentElement = $el.parent();

                    // Look up to 3 parent levels for images
                    for (let i = 0; i < 3 && !imageUrl; i++) {
                        if (parentElement.length) {
                            // Try to find image in this parent
                            const img = parentElement.find('img').first();
                            if (img.length) {
                                imageUrl = img.attr('src') || img.attr('data-src');
                            }

                            // Move up one level
                            parentElement = parentElement.parent();
                        }
                    }

                    // If no image found directly, try to match with collected images
                    if (!imageUrl && allImages.length > 0) {
                        let bestImageMatch = allImages.find(img =>
                            img.alt && title.includes(img.alt) ||
                            img.alt && img.alt.includes(title.substring(0, 20))
                        );
                        if (bestImageMatch) {
                            imageUrl = bestImageMatch.src;
                        }
                    }

                    // Try to extract full article content URL
                    let fullLink = link;
                    if (fullLink && !fullLink.includes('://')) {
                        // If it's a relative URL, make it absolute
                        fullLink = fullLink.startsWith('/')
                            ? `https://www.nintendo.com${fullLink}`
                            : `https://www.nintendo.com/${fullLink}`;
                    }

                    newsLinks.push({
                        title: title,
                        link: fullLink,
                        date: date,
                        imageUrl: imageUrl,
                        description: 'Nintendo news update'
                    });
                }
            });

            // Sort by date (newest first)
            newsLinks.sort((a, b) => {
                if (!a.date) return 1;
                if (!b.date) return -1;
                return new Date(b.date) - new Date(a.date);
            });

            // Take only the requested number of items
            return newsLinks.slice(0, limit);
        }

        // Regular selector-based processing if selectors worked
        console.log(`Using selector: ${selectedSelector}`);

        // Process news items with the working selector
        $(selectedSelector).each((index, element) => {
            if (index >= limit) return;

            const $element = $(element);
            console.log(`Processing item ${index + 1}`);

            // Try multiple potential selectors for title
            let title = $element.find('h3').text().trim();
            if (!title) title = $element.find('h2').text().trim();
            if (!title) title = $element.find('.title').text().trim();
            if (!title) title = $element.find('.heading').text().trim();

            // Try to find link
            let link = $element.find('a').attr('href');
            if (!link && $element.is('a')) link = $element.attr('href');

            const fullLink = link && link.startsWith('/') ? `https://www.nintendo.com${link}` : link;

            // Try multiple date selectors
            let date = $element.find('.DateUtility-module__date').text().trim();
            if (!date) date = $element.find('.date').text().trim();
            if (!date) date = $element.find('time').text().trim();

            // Try multiple image selectors
            let imageUrl = $element.find('img').attr('src');
            if (!imageUrl) imageUrl = $element.find('.image img').attr('src');
            if (!imageUrl) imageUrl = $element.find('picture source').attr('srcset');

            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = `https://www.nintendo.com${imageUrl}`;
            }

            // Try multiple description selectors
            let description = $element.find('p').text().trim();
            if (!description) description = $element.find('.description').text().trim();
            if (!description) description = $element.find('.summary').text().trim();

            console.log(`Found item: ${title || 'No title'}`);

            if (title || description) {
                newsItems.push({
                    title: title || 'Nintendo News Update',
                    link: fullLink || NINTENDO_NEWS_URL,
                    date,
                    imageUrl,
                    description
                });
            }
        });

        console.log(`Total news items found: ${newsItems.length}`);
        return newsItems;
    } catch (error) {
        console.error('Error fetching Nintendo news:', error);
        return [];
    }
}

// Initialize REST API client
const rest = new REST({ version: '9' }).setToken(BOT_TOKEN);
client.login(BOT_TOKEN);

// Define commands
const commands = [
    {
        name: 'nintendonews',
        description: 'Fetch the latest Nintendo news',
        options: [
            {
                name: 'count',
                description: 'Number of news items to fetch (1-5)',
                type: ApplicationCommandOptionType.Integer,
                required: false,
                choices: [
                    { name: '1 news item', value: 1 },
                    { name: '3 news items', value: 3 },
                    { name: '5 news items', value: 5 }
                ]
            }
        ]
    },
    {
        name: 'setupchannels',
        description: 'Create dedicated Nintendo news channels (Admin only)',
        options: []
    }
];

// Add this after creating the limiter
limiter.on('received', () => {
    console.log(`Rate limit: ${limiter.counts().RECEIVED} requests received`);
});

limiter.on('queued', () => {
    console.log(`Rate limit: ${limiter.counts().QUEUED} requests queued`);
});

limiter.on('depleted', () => {
    console.log('Rate limit depleted - waiting for refresh');
});

limiter.on('error', (err) => {
    console.error('Rate limiter error:', err);
});

// Add below the interactionCreate event handler
client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent loops
    if (message.author.bot) return;

    // Check if the bot is mentioned
    if (message.mentions.has(client.user)) {
        // Get content without the mention
        const content = message.content.replace(/<@!?(\d+)>/g, '').trim().toLowerCase();

        // Check for different keywords
        if (content === 'hello' || content === 'hi') {
            await message.reply('Hello! I\'m a bot to fetch the latest Nintendo news. Mention me with "help" to learn more about my commands!');
        }
        else if (content === 'help' || content === 'commands') {
            const helpEmbed = {
                color: 0x0099ff,
                title: 'Nintendo News Bot Help',
                description: 'Here are the commands you can use:',
                //const ALLOWED_CHANNEL_NAMES = ['nintendo-news', 'switch-updates', 'gaming-news'];
                fields: [
                    {
                        name: '/nintendonews',
                        value: 'Fetch the latest Nintendo news. You can specify the number of news items to fetch (1-5). Default is 3.'
                    },
                    {
                        name: '/setupchannels',
                        value: 'Create dedicated Nintendo news channels in your server (Admin only).'
                    }
                ],
                footer: {
                    text: 'Use these commands in #nintendo-news, #switch-updates, or #gaming-news channels.'
                }
            };

            await message.reply({ embeds: [helpEmbed] });
        }
        else if (content.includes('nitendonews') || content.includes('search news')) {
            await message.reply('To fetch the latest Nintendo news, use the `/nintendonews` command!');
        }
        else if (content.includes('setupchannels')) {
            await message.reply('To create dedicated Nintendo news channels, use the `/setupchannels` command(Admin only).');
        }
        else if (content.includes('nitendo')) {
            await message.reply('It looks like you\'re trying to say "Nintendo".');
        }
        else if (content.includes('nitendo news')) {
            await message.reply('To fetch the latest Nintendo news, use the `/nintendonews` command!');
        }
        else {
            await message.reply('Sorry, I don\'t understand that command. Use "help" to see the available commands.');
        }
    }
});

// Register slash commands when the bot is ready
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        console.log('Started refreshing application commands.');

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );

        console.log('Successfully registered application commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

client.on('guildCreate', async guild => {
    try {
        console.log(`Joined a new guild: ${guild.name} (${guild.id}). Registering slash commands...`);

        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id),
            { body: commands },
        );
        // Fix: use CLIENT_ID instead of env.CLIENT_ID
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guild.id),
            { body: commands },
        );

        console.log('Successfully registered slash commands for guild:', guild.name);
    } catch (error) {
        console.error('Error registering slash commands on guildCreate:', error);
    }
});

// Handle slash commands
// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // Get command info from the interaction
    const { commandName, options } = interaction;

    if (commandName === 'nintendonews') {
        await interaction.deferReply();

        try {
            const count = options.getInteger('count') || 3;

            // Check for any of the allowed channels
            let targetChannel = null;
            let channelName = '';

            // Add this warning for larger requests
            if (count > 3) {
                await interaction.editReply(`Fetching ${count} Nintendo news items... This may take a bit longer due to rate limiting (max 30 requests per minute).`);
            } else {
                await interaction.editReply(`Fetching Nintendo news... This will be posted in ${targetChannel}.`);
            }

            // Only try to find/create channels if we're in a guild
            if (interaction.guild) {
                // First, check if any of the allowed channels exist
                for (const allowedChannel of ALLOWED_CHANNEL_NAMES) {
                    const foundChannel = interaction.guild.channels.cache.find(
                        ch => ch.name === allowedChannel && ch.type === 0 // 0 is text channel
                    );

                    if (foundChannel) {
                        targetChannel = foundChannel;
                        channelName = allowedChannel;
                        console.log(`Found existing channel: #${allowedChannel}`);
                        break;
                    }
                }

                // If no allowed channel exists, create one
                if (!targetChannel) {
                    try {
                        console.log('No allowed channels found, creating one...');

                        // Check if the bot has permission to create channels
                        const botPerms = interaction.guild.members.me.permissions;
                        if (!botPerms.has(PermissionsBitField.Flags.ManageChannels)) {
                            await interaction.editReply("I don't have permission to create channels. Please create a #nintendo-news channel or give me the 'Manage Channels' permission.");
                            return;
                        }

                        // Create the default channel (first in the list)
                        channelName = ALLOWED_CHANNEL_NAMES[0];
                        targetChannel = await interaction.guild.channels.create({
                            name: channelName,
                            type: 0, // Text channel
                            permissionOverwrites: [
                                {
                                    id: interaction.guild.id, // @everyone role
                                    allow: [PermissionsBitField.Flags.ViewChannel],
                                    deny: []
                                },
                                {
                                    id: client.user.id, // The bot itself
                                    allow: [
                                        PermissionsBitField.Flags.ViewChannel,
                                        PermissionsBitField.Flags.SendMessages,
                                        PermissionsBitField.Flags.EmbedLinks
                                    ],
                                    deny: []
                                }
                            ],
                            reason: 'Created for Nintendo News'
                        });

                        await interaction.editReply(`Created new channel #${channelName} for Nintendo news!`);
                    } catch (createError) {
                        console.error('Error creating channel:', createError);
                        await interaction.editReply(`Failed to create a channel: ${createError.message}. Using current channel instead.`);
                        targetChannel = interaction.channel;
                    }
                }
            } else {
                // We're not in a guild (DM), use the current channel
                targetChannel = interaction.channel;
            }

            // If we still don't have a target channel, fall back to current channel
            if (!targetChannel) {
                targetChannel = interaction.channel;
            }

            // Make sure the bot has the necessary permissions in the target channel
            try {
                const permissions = targetChannel.permissionsFor(interaction.client.user);
                if (!permissions ||
                    !permissions.has(PermissionsBitField.Flags.SendMessages) ||
                    !permissions.has(PermissionsBitField.Flags.EmbedLinks)) {

                    await interaction.editReply(`I don't have permission to send messages in ${targetChannel}. Please give me proper permissions.`);
                    return;
                }
            } catch (err) {
                console.error('Error checking permissions:', err);
            }

            await interaction.editReply(`Fetching Nintendo news... This will be posted in ${targetChannel}.`);
            let newsItems = await fetchNintendoNews(count);

            // Process and send news items
            if (newsItems.length > 0) {
                await interaction.editReply(`Found ${newsItems.length} Nintendo news items! Posting to ${targetChannel}.`);

                // Process each news item and send to the target channel
                for (const news of newsItems) {
                    // [existing code to process article details]
                    if ((!news.imageUrl || news.description === 'Nintendo news update') && news.link) {
                        console.log(`Fetching details for article: ${news.title}`);
                        try {
                            const articleDetails = await fetchArticleDetails(news.link);

                            if (!news.imageUrl && articleDetails.imageUrl) {
                                news.imageUrl = articleDetails.imageUrl;
                            }

                            if (news.description === 'Nintendo news update' && articleDetails.description !== 'Nintendo news update') {
                                news.description = articleDetails.description;
                            }
                        } catch (detailsError) {
                            console.error('Error fetching article details:', detailsError);
                        }
                    }

                    // [existing code to truncate titles]
                    let title = news.title;
                    let description = news.description;

                    if (title && title.length > 250) {
                        const breakPoint = title.indexOf('.');
                        if (breakPoint > 10 && breakPoint < 240) {
                            description = title.substring(breakPoint + 1).trim() + (description ? '\n\n' + description : '');
                            title = title.substring(0, breakPoint + 1).trim();
                        } else {
                            description = title.substring(250) + (description ? '...\n\n' + description : '...');
                            title = title.substring(0, 250) + '...';
                        }
                    }

                    // Create the embed with improved article design
                    const newsEmbed = new EmbedBuilder()
                        .setColor('#ff0000') // Nintendo red
                        .setTitle(title)
                        .setURL(news.link);

                    // Format the description to look more like an article
                    let formattedDescription = '';

                    // Add date at the top if available
                    if (news.date) {
                        formattedDescription += `📅 **Published:** ${news.date}\n\n`;
                    }

                    // Add the article content with proper formatting
                    if (description) {
                        // Clean up the description and format it
                        description = description.trim();

                        // Split into paragraphs for better readability
                        const paragraphs = description.split('\n').filter(p => p.trim().length > 0);

                        // Add formatted paragraphs
                        formattedDescription += paragraphs.map(p => `${p}`).join('\n\n');

                        // Add a "Read more" link at the bottom
                        formattedDescription += `\n\n[**Read the full article on Nintendo.com →**](${news.link})`;

                        // Make sure it's not too long
                        if (formattedDescription.length > 4000) {
                            formattedDescription = formattedDescription.substring(0, 3950) + '...\n\n' +
                                `[**Read the full article on Nintendo.com →**](${news.link})`;
                        }

                        newsEmbed.setDescription(formattedDescription);
                    }

                    // Add the author info at the top
                    newsEmbed.setAuthor({
                        name: 'Nintendo News',
                        iconURL: 'https://assets.nintendo.com/image/upload/f_auto/q_auto/dpr_2.0/c_scale,w_300/Dev/nin-design-system/icons/favicon.png',
                        url: 'https://www.nintendo.com/us/whatsnew/'
                    });

                    // Add the image if available
                    if (news.imageUrl) {
                        newsEmbed.setImage(news.imageUrl);
                    }

                    // Add a more professional footer with timestamp
                    newsEmbed.setFooter({
                        text: 'Nintendo News • Shared via Nintendo News Bot',
                        iconURL: client.user.displayAvatarURL()
                    })
                        .setTimestamp();

                    // Send the embed to the target channel
                    await targetChannel.send({ embeds: [newsEmbed] });
                }

                // Final confirmation
                await interaction.editReply(`Successfully posted ${newsItems.length} Nintendo news items to ${targetChannel}!`);

            } else {
                await interaction.editReply('No Nintendo news items could be found.');
            }
        } catch (error) {
            console.error('Error processing Nintendo news:', error);
            await interaction.editReply('Sorry, I couldn\'t fetch Nintendo news at this time: ' + error.message);
        }
    }

    if (commandName === 'setupchannels') {
        // Only respond to guild commands, not DMs
        if (!interaction.guild) {
            await interaction.reply({
                content: 'This command can only be used in a server!',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        // Check if user has admin permissions
        if (!interaction.memberPermissions.has(PermissionsBitField.FLAGS.ADMINISTRATOR)) {
            await interaction.editReply('You need administrator permissions to use this command.');
            return;
        }

        try {
            const guild = interaction.guild;

            // Create the bot role if it doesn't exist
            let botRole = guild.roles.cache.find(role => role.name === 'Nintendo News Bot');
            if (!botRole) {
                botRole = await guild.roles.create({
                    name: 'Nintendo News Bot',
                    color: 'Green',
                    reason: 'Role for Nintendo News Bot',
                    permissions: []  // No special permissions in the role itself
                });

                // Try to assign the role to the bot
                try {
                    const botMember = await guild.members.fetch(client.user.id);
                    await botMember.roles.add(botRole);
                } catch (roleError) {
                    console.error('Could not assign role to bot:', roleError);
                    // Continue anyway since the channels can still work
                }
            }

            // Create the channels
            const createdChannels = [];
            for (const channelName of ALLOWED_CHANNEL_NAMES) {
                let channel = guild.channels.cache.find(ch => ch.name === channelName);

                if (!channel) {
                    try {
                        channel = await guild.channels.create({
                            name: channelName,
                            type: 0, // Text channel
                            permissionOverwrites: [
                                {
                                    id: guild.id, // @everyone role
                                    allow: [PermissionsBitField.Flags.ViewChannel],
                                    deny: []
                                },
                                {
                                    id: client.user.id, // The bot itself
                                    allow: [
                                        PermissionsBitField.Flags.ViewChannel,
                                        PermissionsBitField.Flags.SendMessages,
                                        PermissionsBitField.Flags.EmbedLinks
                                    ],
                                    deny: []
                                }
                            ],
                            reason: 'Created by Nintendo News Bot'
                        });
                        createdChannels.push(channel.name);
                    } catch (channelError) {
                        console.error(`Failed to create channel ${channelName}:`, channelError);
                        await interaction.followUp({
                            content: `Failed to create #${channelName}: ${channelError.message}`,
                            ephemeral: true
                        });
                    }
                }
            }

            if (createdChannels.length > 0) {
                await interaction.editReply(`Successfully created channels: #${createdChannels.join(', #')}`);
            } else {
                await interaction.editReply('All necessary channels already exist or could not be created due to permission issues.');
            }
        } catch (error) {
            console.error('Error setting up channels:', error);
            await interaction.editReply('Failed to set up channels: ' + error.message);
        }
    }
});