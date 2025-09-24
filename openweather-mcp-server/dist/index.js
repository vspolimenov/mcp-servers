"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const axios_1 = __importDefault(require("axios"));
const server = new index_js_1.Server({
    name: "openweather-mcp-server",
    version: "1.0.0",
    capabilities: {
        tools: {},
    },
});
const apiKey = process.env.OPENWEATHER_API_KEY;
if (!apiKey) {
    console.error("Error: OPENWEATHER_API_KEY environment variable is not set.");
    process.exit(1);
}
server.setRequestHandler(zod_1.z.object({
    method: zod_1.z.literal("tools/list"),
}), async () => {
    return {
        tools: [
            {
                name: "get_current_weather",
                description: "Get current weather data for a city",
                inputSchema: {
                    type: "object",
                    properties: {
                        city: {
                            type: "string",
                            description: "Name of the city (e.g., London)",
                        },
                    },
                    required: ["city"],
                },
            },
            {
                name: "get_forecast",
                description: "Get 5-day weather forecast for a city",
                inputSchema: {
                    type: "object",
                    properties: {
                        city: {
                            type: "string",
                            description: "Name of the city (e.g., London)",
                        },
                    },
                    required: ["city"],
                },
            },
        ],
    };
});
server.setRequestHandler(zod_1.z.object({
    method: zod_1.z.literal("tools/call"),
    params: zod_1.z.object({
        name: zod_1.z.string(),
        arguments: zod_1.z.record(zod_1.z.any()),
    }),
}), async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "get_current_weather") {
        const city = args.city || "";
        if (!city) {
            return { content: [{ type: "text", text: "Error: City is required." }] };
        }
        try {
            const response = await axios_1.default.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`);
            const data = response.data;
            const result = `Current weather in ${data.name}: ${data.weather[0].description}, Temperature: ${data.main.temp}°C, Humidity: ${data.main.humidity}%, Wind Speed: ${data.wind.speed} m/s.`;
            return { content: [{ type: "text", text: result }] };
        }
        catch (error) {
            if (error instanceof Error) {
                console.error("Error fetching current weather:", error.message);
            }
            else {
                console.error("Unknown error fetching current weather");
            }
            return { content: [{ type: "text", text: "Error: Unable to fetch current weather. Please check your API key and city name." }] };
        }
    }
    if (name === "get_forecast") {
        const city = args.city || "";
        if (!city) {
            return { content: [{ type: "text", text: "Error: City is required." }] };
        }
        try {
            const response = await axios_1.default.get(`https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${apiKey}&units=metric`);
            const data = response.data;
            let result = `5-day forecast for ${data.city.name}:\n`;
            for (let i = 0; i < data.list.length; i += 8) {
                const item = data.list[i];
                const date = new Date(item.dt * 1000).toLocaleDateString();
                result += `${date}: ${item.weather[0].description}, Temp: ${item.main.temp}°C, Humidity: ${item.main.humidity}%\n`;
            }
            return { content: [{ type: "text", text: result }] };
        }
        catch (error) {
            if (error instanceof Error) {
                console.error("Error fetching forecast:", error.message);
            }
            else {
                console.error("Unknown error fetching forecast");
            }
            return { content: [{ type: "text", text: "Error: Unable to fetch forecast. Please check your API key and city name." }] };
        }
    }
    return { content: [{ type: "text", text: "Error: Unknown tool." }] };
});
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("OpenWeatherMap MCP server running");
}
main().catch((error) => {
    if (error instanceof Error) {
        console.error("Server error:", error.message);
    }
    else {
        console.error("Unknown server error");
    }
    process.exit(1);
});
