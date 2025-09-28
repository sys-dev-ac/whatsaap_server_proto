import { Router } from "express";
import { CreateTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"; // help to manage the operations 
import 'dotenv/config'

const config = process.env.production ? {
    region: "us-west-2",
} : {
    region: "local",
    endpoint: "http://localhost:8000" // for local dynamodb
};

const client = new DynamoDBClient(config);

const db = DynamoDBDocumentClient.from(client);

const router = Router();

router.post('/create', async (req, res) => {
    const { table_name } = req.body;

    const createParams = {
        TableName: table_name,
        // here we are decalring the primary key
        KeySchema: [{
            AttributeName: "id",
            KeyType: "HASH"
        }],
        AttributeDefinitions: [{
            AttributeName: "id",
            AttributeType: "S"
        }],
        ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
        }
    };

    // create new table 
    try {
        const data = await db.send(new CreateTableCommand(createParams));
        console.log("Table Created", data);
        return res.status(200).json({ message: "Table created", data });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: "Could not create table" });
    }
});

router.post('/create/whatsaap', async (req, res) => {
    try {
        const data = await client.send(new CreateTableCommand({
            TableName: "WhatsAppAuth",
            AttributeDefinitions: [{ AttributeName: "PK", AttributeType: "S" }],
            KeySchema: [{ AttributeName: "PK", KeyType: "HASH" }],
            BillingMode: "PAY_PER_REQUEST"
        }));

        console.log("Table Created", data);
        return res.status(200).json({ message: "Table created", data });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: "Could not create table" });
    }
})

router.post('/add', async (req, res) => {
    try {
        const params = {
            TableName: "LearnDB",
            Item: {
                id: req.body.id,
                name: req.body.name,
                description: req.body.description
            }
        }

        const data = await db.send(new PutCommand(params));
        console.log("Item Added", data);
        return res.status(200).json({ message: "Item added", data });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: "could not create table" })
    }
})

router.get('/getdata', async (req, res) => {
    try {
        const params = {
            TableName: 'WhatsAppAuth',
        }

        const data = await db.send(new ScanCommand(params));

        console.log("the data ", data);
        res.status(200).json({ data: data.Items });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ error: "could not create table" })
    }
})

export default router;