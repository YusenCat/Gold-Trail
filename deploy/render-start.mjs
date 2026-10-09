// Render's fixed service URL is deployment configuration, never a request header.
process.env.GAME_MODE='public';
if(!process.env.GAME_PUBLIC_ORIGIN&&process.env.RENDER_EXTERNAL_URL)process.env.GAME_PUBLIC_ORIGIN=process.env.RENDER_EXTERNAL_URL;
await import('../apps/server/server.ts');
