/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL_NAME: process.env.OPENAI_MODEL_NAME,
    OPENAI_TEMPERATURE: process.env.OPENAI_TEMPERATURE,
  },
}

export default nextConfig;
