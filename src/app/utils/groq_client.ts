import Groq from "groq-sdk"
import { Chat } from "groq-sdk/resources/index.mjs";

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

interface ChatMessage {
    role: "system" | "user" | "assistant"; 
    content: string;
}

export async function getGroqResponse(chatMessages: ChatMessage[]) {
    const messages: ChatMessage[] = [
        { 
            role: "system", 
            content: "You are a answering engine that is repsonsible for taking in user input and giving them an omptimable and concise answer. You always provide the sources to your information as well as how reliable the source is. You can also use the previous conversations and details within the context of the chat to give better rounded answers" },
        ...chatMessages
    ];

    console.log("List of messages:", messages);
    console.log("Starting groq api request");

    const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages,
    });

    // console.log("Received groq apu request", response);

    return response.choices[0].message.content;
}