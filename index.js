require('dotenv').config()
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();
const port = 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rkfual6.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        

        const database = client.db("bistroDB");

        const bistroUsersCollections = database.collection("users");
        const bistroMenuCollections = database.collection("menu");
        const bistroTestimonialCollections = database.collection("testimonial");
        const bistroChefsRecommendCollections = database.collection("chefsRecommend");
        const bistroCartsCollections = database.collection("carts");
        const bistroPaymentCollections = database.collection("payments");

        // JWT RELATED API:
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })

        // Middlewares:
        const verifyToken = (req, res, next) => {
            // console.log(req.headers.authorization);

            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }

            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
                if (err) {
                    return res.status(401).send({ message: 'Unauthorized Access' })
                }
                req.decoded = decoded;
                next();
            });
        }

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await bistroUsersCollections.findOne(query);
            const isAdmin = (user?.role === 'admin');
            if (!isAdmin) {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            next();
        }


        // Getting Data:
        app.get('/menu', async (req, res) => {
            const result = await bistroMenuCollections.find().toArray();
            res.send(result)
        })
        app.get('/testimonials', async (req, res) => {
            const result = await bistroTestimonialCollections.find().toArray();
            res.send(result)
        })
        app.get('/chefsRecommend', async (req, res) => {
            const result = await bistroChefsRecommendCollections.find().toArray();
            res.send(result)
        })
        app.get('/carts', async (req, res) => {
            const userEmail = req.query.email
            const query = { email: userEmail };

            const cartCollection = await bistroCartsCollections.find(query).toArray();
            res.send(cartCollection)
        })
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await bistroUsersCollections.find().toArray();
            res.send(result)
        })
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email != req.decoded.email) {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            const query = { email: email };
            const user = await bistroUsersCollections.findOne(query);
            let admin = false;
            if (user) {
                admin = user.role === 'admin'
            }
            res.send({ admin })
        })
        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bistroMenuCollections.findOne(query);
            res.send(result)
        })

        // Stats/Analytics:
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await bistroUsersCollections.estimatedDocumentCount();
            const menuItems = await bistroMenuCollections.estimatedDocumentCount();
            const orders = await bistroPaymentCollections.estimatedDocumentCount();

            // Not The Best Way:
            // const payments = await bistroPaymentCollections.find().toArray();
            // const revenue = payments.reduce((acc, agg) => acc + agg.price, 0)

            const result = await bistroPaymentCollections.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();
            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            res.send({
                users,
                menuItems,
                orders,
                revenue
            })
        })

        app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
            const result = await bistroPaymentCollections.aggregate([
                {
                    $unwind: '$menuItemIds'
                },
                {
                    $set: { menuItemIds: { $convert: { input: '$menuItemIds', to: 'objectId' } } }
                },
                {
                    $lookup: {
                        from:'menu',
                        localField: 'menuItemIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: '$menuItems'
                },
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: {$sum: 1},
                        revenue: {$sum: '$menuItems.price'}
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue'
                    }
                }
            ]).toArray();
            res.send(result)
        })


        // Posting Data:
        app.post('/carts', async (req, res) => {
            // console.log(req.body);
            const result = await bistroCartsCollections.insertOne(req.body);
            res.send(result);
        })
        app.post('/users', async (req, res) => {
            // console.log(req.body);
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await bistroUsersCollections.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }

            const result = await bistroUsersCollections.insertOne(user);
            res.send(result);
        })
        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const item = req.body;
            const result = await bistroMenuCollections.insertOne(item);
            res.send(result)
        })

        // Payment Related APIs:
        app.post("/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            console.log(amount, 'inside payment')

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })
        app.post('/payment', async (req, res) => {
            const payment = req.body;
            const paymentResult = await bistroPaymentCollections.insertOne(payment)

            console.log(payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const deleteResult = await bistroCartsCollections.deleteMany(query)
            res.send({ paymentResult, deleteResult });
        })
        app.get('/payment/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email }

            if (req.params.email != req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const result = await bistroPaymentCollections.find(query).toArray();
            res.send(result)
        })

        // Deleting Data:
        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) };
            const result = await bistroCartsCollections.deleteOne(query);
            res.send(result)
        })
        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bistroUsersCollections.deleteOne(query);
            res.send(result);
        })
        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bistroMenuCollections.deleteOne(query);
            res.send(result);
        })

        // Patching/Putting Data
        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            }
            const result = await bistroUsersCollections.updateOne(filter, updateDoc)
            res.send(result);
        })
        app.patch('/menu/:id', async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    name: item.name,
                    recipe: item.recipe,
                    image: item.image,
                    category: item.category,
                    price: item.price
                },
            }
            const result = await bistroMenuCollections.updateOne(filter, updateDoc);

            res.send(result)
        })

        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello bhai')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})