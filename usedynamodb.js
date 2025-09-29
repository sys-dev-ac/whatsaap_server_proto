import { BufferJSON, initAuthCreds, proto } from "baileys"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb"

const config = process.env.production ? {
    region: "ap-south-1",
} : {
    region: "local",
    endpoint: "http://localhost:8000" // for local dynamodb
};

const client = new DynamoDBClient(config);

const docClient = DynamoDBDocumentClient.from(client)

const useDynamoDBAuthState = async (tableName, userId) => {

    // Read the full user state (creds + keys) from DynamoDB
    const readUserState = async () => {
        try {
            const { Item } = await docClient.send(new GetCommand({
                TableName: tableName,
                Key: { PK: `user:${userId}` }
            }))
            if (!Item) return null
            delete Item.PK
            return JSON.parse(JSON.stringify(Item), BufferJSON.reviver)
        } catch (err) {
            console.error("readUserState error:", err)
            return null
        }
    }

    // Write the full user state to DynamoDB
    const writeUserState = async (state) => {
        const item = JSON.parse(JSON.stringify(state, BufferJSON.replacer))
        await docClient.send(new PutCommand({
            TableName: tableName,
            Item: { PK: `user:${userId}`, ...item }
        }))
    }

    // Load existing state or initialize new
    const existingState = (await readUserState()) || { creds: initAuthCreds(), keys: {} }
    const state = {
        creds: existingState.creds,
        keys: {
            get: async (type, ids) => {
                const allKeys = existingState.keys || {}
                const data = {}
                for (const id of ids) {
                    let value = allKeys[`${type}-${id}`] || null
                    if (value && type === 'app-state-sync-key') {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value)
                    }
                    data[id] = value
                }
                return data
            },
            set: async (data) => {
                const allKeys = existingState.keys || {}
                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const key = `${category}-${id}`
                        const value = data[category][id]
                        if (value) {
                            allKeys[key] = value
                        } else {
                            delete allKeys[key]
                        }
                    }
                }
                existingState.keys = allKeys
                await writeUserState(existingState)
            }
        }
    }

    return {
        state,
        saveCreds: async () => {
            existingState.creds = state.creds
            await writeUserState(existingState)
        }
    }
}

export default useDynamoDBAuthState
