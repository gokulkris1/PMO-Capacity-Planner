# Adding Your OpenAI API Key Securely to Netlify

To ensure your API key is never exposed to the public or saved in your code repository, you must add it securely directly into your Netlify dashboard. 

Here are the exact steps to add it for your live demo:

1. Log into your [Netlify Dashboard](https://app.netlify.com/).
2. Click on your site (**PMO-Capacity-Planner** or whatever you named it).
3. On the left sidebar, click **Site configuration**.
4. Scroll down and click on **Environment variables**.
5. Click the **Add a variable** button > choose **Add a single variable**.
6. Set the **Key** to `OPENAI_API_KEY`.
7. Paste your `sk-...` secret token into the **Value** box.
8. Check the boxes so it applies to *Production* (or *All contexts*).
9. Click **Create variable**.
10. Finally, go to your site's **Deploys** tab and click **Trigger deploy** > **Clear cache and deploy site** to force the server to load the new key. 

Wait 60 seconds for the deploy to finish, and the AI will work perfectly!
