# Nitendo Last News Discord Bot
A powerful Discord bot that allows users to search for anime and manga information using the MyAnimeList database via the Jikan API.

## Features
- Search last news from [Nintendo](https://www.nintendo.com/us/whatsnew/)
- 

Add this bot to your Discord server:
[Invite Link](https://discord.com/oauth2/authorize?client_id=1352592460664016916)

## Usage
To use the bot, simply type `/nintendonews` followed by the number of news items you want to fetch last from [Nintendo](https://www.nintendo.com/us/whatsnew/). You can see the results in canals `#bot` or `#anime-manga`.

## Roles and Permissions
This bot requires the following roles:
- `@everyone`: To receive search results in the `#bot` or `#nitendo-news` channels.
- `@everyone`: To use the slash commands `/nintendonews`.
- Send Messages: To receive search results in the `#bot` or `#nitendo-news` channels.
- View Channel: To receive search results in the `#bot` or `#nitendo-news` channels.
- Embed Links: To receive search results in the paste trailer links to corresponding research to use commands `/nintendonews`.

## Commands
The bot supports the following slash commands:

### Nitendo News
- **Command:** `/nintendonews`
- **Parameters:**
  - `count`: Number of news items to fetch (1-5). Default is 3.


## Setup for Development
If you want to run or modify this bot locally:

### Steps:
1. Clone this repository:
   ```sh
   git clone https://github.com/your-repo-name.git
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Update `config.json` with your Discord bot token and client ID.
4. Run the bot:
   ```sh
   node index.js
   ```

### Requirements:
- Node.js (v14.x or newer)
- Discord.js v14
- A Discord bot token

## Credits
This bot uses the Jikan API to fetch anime and manga data from MyAnimeList.

## License
This project is licensed under the [MIT License](LICENSE).