import Redis from "ioredis";
import 'dotenv/config'

const redis = new Redis(process.env.REDIS_URL);

const clearState = async () => {
    await redis.flushall();
}

export default redis;
export {
    clearState
};