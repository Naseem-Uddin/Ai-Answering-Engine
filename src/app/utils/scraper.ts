import axios from "axios";
import * as cheerio from "cheerio";
import { Logger } from "./logger"
import { Redis } from "@upstash/redis"
import { parse } from "path";
import { cache } from "react";

const logger = new Logger("scraper")

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

// Cache TTL in seconds
const CACHE_TTL = 7 * (24 * 60 * 60);
const MAX_CACHE_SIZE = 1024000;

export const urlPattern = 
    /^(http(s):\/\/.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-z]{1,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/gi;

function cleanText(text: string): string{
    return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim()
}

export async function scrapeUrl(url: string){

    try{
        // Check cache
        logger.info(`Starting scrape process for: ${url}`);
        const cached = await getCachedContent(url);
        
        if (cached){
            logger.info(`Using cached content for: ${url}`);
            return cached;
        }
        logger.info(`Cache miss - proceeding with fresh scrape for: ${url}`);


        // Get URL
        const response = await axios.get(url);

        // Load Cheerio to start scrape
        const $ = cheerio.load(response.data);
        
        // Scraping content
        $("script").remove();
        $("style").remove();
        $("noscript").remove();
        $("iframe").remove();
        // Heading and title
        const title = $("title").text();
        const metaDescription = $('meta[name="description"]').attr("content") || "";
        const h1 = $("h1")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        const h2 = $("h2")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        // Text elements
        const articleText = $("articleText")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        const mainText = $("mainText")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        const contentText = $('.content, #content, [class*="content"]')
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        // Paragraph text
        const paragraphs = $("p")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        // List items
        const listItems = $("li")
            .map((_, el) => $(el).text())
            .get()
            .join(" ");
        // Combine the content
        let combinedContent = [title, metaDescription, h1, h2, articleText, mainText, 
            contentText, paragraphs, listItems].join(" ");
        
        combinedContent = cleanText(combinedContent). slice(0, 40000);
        const finalResponse =  {
            url, title: cleanText(title),
            headings: {
                h1: cleanText(h1),
                h2: cleanText(h2)
            },
            metaDescription: cleanText(metaDescription),
            content: combinedContent,
            error: null,
        };

        await cacheContent(url, finalResponse);

    } catch (error) {
        console.error(`Error Scraping ${url}:`, error);
        return {
            url, 
            title: "",
            headings: { h1: "", h2: "" },
            metaDescription: "",
            content: "",
            error: "Failed to scrape URL",
        };
    }
}

export interface ScrapedContent {
    url: string;
    title: string;
    headings: {
        h1: string;
        h2: string;
    };
    metaDescription: string;
    content: string;
    error: string | null;
    cachedAt?: number;
}

// Validation function for Scraped Content
function isValidScrapedContent(data: any): data is ScrapedContent {
    return (
        typeof data === "object" && 
        data !== null &&
        typeof data.url === "string" &&
        typeof data.title === "string" &&
        typeof data.headings === "object" &&
        typeof data.headings.h1 === "string" &&
        typeof data.headings.h2 === "string" &&
        typeof data.metaDescription === "string" &&
        typeof data.content === "string" &&
        (data.error === null || typeof data.error === "string")
    );
}


// Function to get cache key for a URL with sanitization
function getCacheKey(url: string): string {
    const sanitizedUrl = url.substring(0, 200); 
    return `scrape:${sanitizedUrl}`;
}

// Function to get cached content with error handling
async function getCachedContent(url: string): Promise<ScrapedContent | null>{
    try{
        const cacheKey = getCacheKey(url);
        logger.info(`Checking cache for key: ${cacheKey}`)
        const cached = await redis.get(cacheKey);

        if (!cached){
            logger.info(`Cache miss - No cached content found for: ${url}`);
            return null;
        }

        logger.info(`Cache hit - Found cached content for: ${url}`);

        // Use Redis to handle string and objects representations
        let parsed: any;
        if (typeof cached == "string"){
            try{
                parsed = JSON.parse(cached);
            } catch (parseError){
                logger.error(`JSON parse error for cached content: ${parseError}`);
                await redis.del(cacheKey);
                return null;
            }
        }
        else {
            parsed = cached;
        }

        if (isValidScrapedContent(parsed)){
            const age = Date.now() - (parsed.cachedAt || 0);
            logger.info(`Cached content age: ${Math.round(age / 1000 / 60)} minutes`);
            return parsed;
        }

        logger.warn(`Invalid cached content format for URL: ${url}`);
        await redis.del(cacheKey);
        return null;
    } catch (error) {
        logger.error(`Cache retrieval error: ${error}`);
        return null;
    }
}

// Function to cache scraped content with error handling
async function cacheContent(
    url: string,
    content: ScrapedContent
): Promise <void> {
    try{
        const cacheKey = getCacheKey(url);
        content.cachedAt = Date.now();

        if (isValidScrapedContent(content)){
            logger.error(`Attempted to cache invalid content format for URL: ${url}`);
            return;
        }
        
        const serialized = JSON.stringify(content);
        
        if (serialized.length > MAX_CACHE_SIZE){
            logger.warn(`Content too large to cache for URL: ${url} (${serialized.length} bytes)`);
            return;
        }

        await redis.set(cacheKey, serialized, {ex: CACHE_TTL});
        logger.info(`Successfully cached content for: ${url} (${serialized.length} byte, TTL: ${CACHE_TTL})`);

    } catch (error){
        logger.error(`Cache storage error: ${error}`);
    }
}