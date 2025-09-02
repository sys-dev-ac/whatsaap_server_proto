// import { BufferJSON, initAuthCreds, proto } from "baileys"

// const useMongoDBAuthState = async (collection, userId) => {

//     const writeData = (state, id) => {

//         const info = JSON.parse(
//             JSON.stringify(state, BufferJSON.replacer)
//         );

//         const update = {
//             $set: {
//                 ...info,
//             }
//         };


//         return collection.updateOne({ _id: `${userId}:${id}` }, update, { upsert: true });
//     }

//     const readData = async (id) => {
//         try {
//             const doc = await collection.findOne({ _id: `${userId}:${id}` });
//             if (!doc) return null;

//             // remove _id, then revive properly
//             delete doc._id;
//             return JSON.parse(JSON.stringify(doc), BufferJSON.reviver);

//         } catch (error) {
//             console.log(error);
//         }
//     }

//     const removeData = async (id) => {
//         try {
//             await collection.deleteOne({ _id: `${userId}:${id}` });
//         } catch (error) {
//             console.log(error);
//         }
//     }

//     const creds = (await readData('creds')) || (0, initAuthCreds)();

//     return {
//         state: {
//             creds,
//             keys: {
//                 get: async (type, ids) => {
//                     const data = {};
//                     await Promise.all(
//                         ids.map(async (id) => {
//                             let value = await readData(`${type}-${id}`);

//                             if (type === 'app-state-sync-key') {
//                                 value = proto.Message.AppStateSyncKeyData.fromObject(value);
//                             }
//                             data[id] = value;
//                         })
//                     );
//                     return data;
//                 },
//                 set: async (data) => {
//                     const tasks = [];
//                     for (const category of Object.keys(data)) {
//                         for (const id of Object.keys(data[category])) {
//                             const value = data[category][id];
//                             const key = `${category}-${id}`;

//                             tasks.push(value ? writeData(value, key) : removeData(key));
//                         }
//                     }

//                     await Promise.all(tasks);
//                 }
//             }
//         },

//         saveCreds: () => {
//             return writeData(authcreds, 'creds');;
//         }

//     }
// }

// export default useMongoDBAuthState;

import { BufferJSON, initAuthCreds, proto } from "baileys"

const useMongoDBAuthState = async (collection, userId) => {

    const writeData = (state, id) => {
        const info = JSON.parse(
            JSON.stringify(state, BufferJSON.replacer)
        );

        const update = { $set: { ...info } }
        return collection.updateOne({ _id: `${userId}:${id}` }, update, { upsert: true })
    }

    const readData = async (id) => {
        try {
            const doc = await collection.findOne({ _id: `${userId}:${id}` })
            if (!doc) return null
            delete doc._id
            return JSON.parse(JSON.stringify(doc), BufferJSON.reviver)
        } catch (error) {
            console.error("readData error:", error)
            return null
        }
    }

    const removeData = async (id) => {
        try {
            await collection.deleteOne({ _id: `${userId}:${id}` })
        } catch (error) {
            console.error("removeData error:", error)
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
        saveCreds: () => writeData(state.creds, 'creds')   // 👈 fixed
    }
}

export default useMongoDBAuthState
