# Parola — Italian word notebook

A small app for learning Italian as a Spanish speaker: dictionary lookups, a homework corrector, saved words and flashcards. It runs in the browser and installs on your phone and PC like an app. There's no server and no account: your words and API key stay on your device.

## Put it online with GitHub Pages (free)

1. Create a free account at github.com.
2. Click **New repository**, name it `parola`, set it to **Public**, and create it.
3. Click **uploading an existing file**, drag in all the files from this folder (`index.html`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `icon-192.png`, `icon-512.png`, `README.md`), and click **Commit changes**.
4. Go to **Settings → Pages**. Under "Branch", choose `main` and `/ (root)`, then **Save**.
5. After a minute or two, your app is live at `https://YOUR-USERNAME.github.io/parola/`.

## Install it

- **Android (Chrome):** open the link, then tap **⋮ → Install app** (or **Add to Home screen**).
- **iPhone (Safari):** open the link, then tap **Share → Add to Home Screen**.
- **PC (Chrome or Edge):** open the link and click the install icon in the address bar.

## Connect an AI

Open **Settings** in the app, choose a provider, paste your API key and tap **Test**, then **Save**.

| Provider | Cost | Where to get a key |
|---|---|---|
| Google Gemini | Free tier | aistudio.google.com/apikey |
| Groq | Free tier | console.groq.com/keys |
| OpenRouter | Free models end in `:free` | openrouter.ai/keys |
| OpenAI | Paid | platform.openai.com/api-keys |
| Anthropic (Claude) | Paid | console.anthropic.com |
| Custom / Ollama | Free, runs on your computer | Start Ollama with `OLLAMA_ORIGINS=*` |

You can type any model name in the **Model** field, so when providers release new models, just change the name there.

Your key is stored only in this browser. Because the app is public, don't share your screen with Settings open, and use a free-tier key if you can.

## Moving words between phone and PC

Words are saved on each device separately. Use **Saved → Export words** on one device and **Import words** on the other. Importing merges the lists and keeps your practice progress. Exporting now and then is also a good backup.

## Updating the app

Edit or replace a file in your GitHub repository and commit. The installed app picks up the new version the next time it opens while online.
