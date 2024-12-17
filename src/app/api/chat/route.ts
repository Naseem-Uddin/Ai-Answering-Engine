// TODO: Implement the chat API with Groq and web scraping with Cheerio and Puppeteer
// Refer to the Next.js Docs on how to read the Request body: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
// Refer to the Groq SDK here on how to use an LLM: https://www.npmjs.com/package/groq-sdk
// Refer to the Cheerio docs here on how to parse HTML: https://cheerio.js.org/docs/basics/loading
// Refer to Puppeteer docs here: https://pptr.dev/guides/what-is-puppeteer

import { NextResponse } from "next/server"
import { getGroqResponse } from "@/app/utils/groq_client"
import { scrapeUrl, urlPattern } from "@/app/utils/scraper"

export async function POST(req: Request) {
  try {
    const { message, messages } = await req.json()

    console.log("Message recieved: ", message)
    console.log("Previous messages: ", messages)

    const url = message.match(urlPattern);

    let scrapedContent = "";
    if (url) {
      console.log("Url Found: ", url)
      const scraperResponse = await scrapeUrl(url);
      console.log("Scraped content: ", scrapedContent)
      if (scraperResponse){
        scrapedContent = scraperResponse.content;
      }
    }

    const userQuery = message.replace(url ? url[0] : '', '').trim();

    const userPrompt = `
    Answer my question: "${userQuery}"

    Based on the following content:
    <content>
      "${scrapedContent}"
    </content>
    `

    const llmMessages = [
      ...messages,
      {
        role: "user",
        content: userPrompt,
      }
    ]

    const response = await getGroqResponse(llmMessages);

    return NextResponse.json({ message: response })

  } catch (error) {
    return NextResponse.json({message: "Error"})
  }
}
