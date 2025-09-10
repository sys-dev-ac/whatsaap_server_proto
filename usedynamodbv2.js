import { BufferJSON, initAuthCreds, proto } from "baileys"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb"

const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: "http://localhost:8000" // for local dynamodb
});

const docClient = DynamoDBDocumentClient.from(client)

const useDynamoDBAuthState = async (tableName, userId) => {

    const writeData = async (state, id) => {
        const item = JSON.parse(JSON.stringify(state, BufferJSON.replacer))
        await docClient.send(new PutCommand({
            TableName: tableName,
            Item: { PK: `${userId}:${id}`, ...item }
        }))
    }

    const readData = async (id) => {
        try {
            const { Item } = await docClient.send(new GetCommand({
                TableName: tableName,
                Key: { PK: `${userId}:${id}` }
            }))
            if (!Item) return null
            delete Item.PK
            return JSON.parse(JSON.stringify(Item), BufferJSON.reviver)
        } catch (err) {
            console.error("readData error:", err)
            return null
        }
    }

    const removeData = async (id) => {
        try {
            await docClient.send(new DeleteCommand({
                TableName: tableName,
                Key: { PK: `${userId}:${id}` }
            }))
        } catch (err) {
            console.error("removeData error:", err)
        }
    }

    // load creds or init new
    const creds = (await readData('creds')) || initAuthCreds()

    // construct auth state object
    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {}
                await Promise.all(
                    ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`)
                        if (value && type === 'app-state-sync-key') {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value)
                        }
                        data[id] = value
                    })
                )
                return data
            },
            set: async (data) => {
                const tasks = []
                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const value = data[category][id]
                        const key = `${category}-${id}`
                        tasks.push(value ? writeData(value, key) : removeData(key))
                    }
                }
                await Promise.all(tasks)
            }
        }
    }

    return {
        state,
        saveCreds: () => writeData(state.creds, 'creds')
    }
}

export default useDynamoDBAuthState
