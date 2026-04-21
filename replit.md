# Project Overview

This is a Node.js Minecraft AFK bot using mineflayer. It connects to the server configured in `settings.json`, exposes a small Express status dashboard, and reconnects automatically when disconnected.

# Runtime

- Main command: `node bot.js`
- Workflow: `Start application`
- Status port: `3000`
- Dashboard: `/`
- Raw status JSON: `/api/status`
- Deployment target: VM for always-running bot behavior

# Notes

- Use `settings.json` to update the bot username, Minecraft server address, version, auto-auth, chat messages, anti-AFK, and reconnect settings.
- If the bot account has no password, the runner uses offline auth so the bot can start without crashing on login.
- The dashboard shows connection state, uptime, last connected/disconnected times, last reconnect time, reconnect count, and the latest error/kick reason.
