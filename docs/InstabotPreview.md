<!-- Copyright 2026 massivehadron.com ltd. -->

# Standalone Instabot preview

The page lives at `instabot-preview-d31b7e4c/`. The portal shows its link next
to OnlyBots under **Admin tools**. The direct URL is public and opens the feed.

The snapshot contains Eggbot's profile and the 22 enabled Instabot accounts.
The browser displays authored captions, crops, likes and comments. Stories
show each account's latest photo for five seconds. The simulated feed starts
receiving posts or activity after 30 seconds, then every 45–90 seconds. Likes
and activity changes last for the visit. Sharing uses the browser's file share
or downloads the displayed crop. Photos default to a 512-pixel maximum dimension.

Refresh the copied data from the Unity checkout with:

```powershell
node tools/export-instabot.mjs C:\GIT\MassiveHadron\TileStormEvolution
```

The exporter writes the website snapshot. Keep any edits to the copied profiles
before refreshing them. For browser review, open the direct URL and the Admin
tools link, then check a story, a post with comments, a like, sharing, and a timed
arrival. Check the expandable profile and activity panels on a narrow screen.
