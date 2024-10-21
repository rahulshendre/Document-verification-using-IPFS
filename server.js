import express from 'express';
import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import fileUpload from 'express-fileupload';
import session from 'express-session'; // Import express-session
import { fileURLToPath } from 'url';
import { configDotenv } from 'dotenv';
import connectDB from './connectDB.js';
import User from './models/user.js';
import Hash from './models/hash.js';

configDotenv();

// Manually define __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware to handle file uploads
connectDB();

app.use(fileUpload());

// Middleware for sessions
app.use(session({
    secret: 'your_secret_key', // Change this to a secure random string
    resave: false,
    saveUninitialized: true,
}));

// Hardcoded Pinata API keys
const pinataApiKey = '6bb619055106b80c2cb7'; // Your Pinata API key
const pinataSecretApiKey = 'f9338c3bb42f9325d428182baebd62c61a8562b48b0589adf12453c111c57d8f'; // Your Pinata secret key

// Middleware to serve static files
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Parse incoming form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Home Route
app.get('/', (req, res) => {
    res.render('index', { ipfsHash: null, verificationMessage: null });
});

// About Route
app.get('/about', (req, res) => {
    res.render('about'); // Ensure you have an 'about.ejs' file in the views directory
});

// Admin Login Route
app.get('/admin-login', (req, res) => {
    res.render('admin-login');
});

// Verifier Login Route
app.get('/verifier-login', (req, res) => {
    res.render('verifier-login');
});

app.get('/verifier-signup', (req, res) => {
    res.render('verifier-signup');
});

app.post('/verifier-signup', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (user) {
            return res.status(400).send("User already exists");
        }

        const newUser = new User({ username, password });
        await newUser.save();

        res.redirect("/verify");
    } catch (error) {
        console.log(error.message);
        return res.status(400).send("Error occurred while signing up");
    }
});

// Handling Admin Login
app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'adminpassword') {
        req.session.user = { role: 'admin' }; 
        res.redirect('/'); 
    } else {
        res.status(401).send('Invalid Admin credentials');
    }
});

// Handling Verifier Login
app.post('/verifier-login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.status(401).send("User not found");
        }

        if (user.password !== password) {
            return res.status(401).send("Incorrect username or password");
        }

        req.session.user = { role: 'verifier', username }; // Store user in session
        res.redirect("/verify");
    } catch (error) {
        console.error(error.message);
        return res.status(500).send("Error while logging in");
    }
});

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next(); // User is authenticated, proceed to the next middleware/route
    }
    res.redirect('/admin-login'); // Redirect to login if not authenticated
};

// Upload Route (handling file upload)
app.post('/upload', isAuthenticated, async (req, res) => {
    const file = req.files?.file;

    if (!file) {
        return res.status(400).send('No file uploaded.');
    }

    const uploadPath = path.join(__dirname, 'uploads', file.name);

    // Save file to local directory
    file.mv(uploadPath, async (err) => {
        if (err) {
            return res.status(500).send('Error saving file.');
        }

        // Upload the file to Pinata
        const formData = new FormData();
        formData.append('file', fs.createReadStream(uploadPath));

        try {
            const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
                    pinata_api_key: pinataApiKey,
                    pinata_secret_api_key: pinataSecretApiKey,
                },
            });

            const ipfsHash = response.data.IpfsHash;

            // Calculate the hash of the original file
            const originalFileHash = calculateFileHash(uploadPath);

            // Retrieve the uploaded file and calculate its hash
            const pinataFile = await axios.get(`https://ipfs.io/ipfs/${ipfsHash}`, { responseType: 'arraybuffer' });
            const retrievedFileHash = crypto.createHash('sha256').update(pinataFile.data).digest('hex');

            // Compare the original file hash with the retrieved file hash
            const verificationMessage = originalFileHash === retrievedFileHash
                ? 'File verified and authentic.'
                : 'File has been altered or is not authentic.';

            // Clean up uploaded file after processing
            fs.unlinkSync(uploadPath);

            // Check if IPFS hash already exists in the database
            const existingHash = await Hash.findOne({ hash: ipfsHash });

            if (!existingHash) {
                const newHash = new Hash({ hash: ipfsHash });
                await newHash.save();
            }

            res.render('index', { ipfsHash, verificationMessage });
        } catch (error) {
            console.error('Error uploading or verifying the file:', error);
            res.status(500).send('Error uploading or verifying the file.');
        }
    });
});

app.get("/verify", (req, res) => {
    res.render("verify", { verificationMessage: null });
});

app.post("/verify", async (req, res) => {
    try {
        const file = req.files?.file;

        if (!file) {
            return res.status(400).send('No file uploaded.');
        }

        // Upload the file directly to Pinata without saving it locally
        const formData = new FormData();
        formData.append('file', file.data, file.name);

        const pinataResponse = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
                pinata_api_key: pinataApiKey,
                pinata_secret_api_key: pinataSecretApiKey,
            },
        });

        const ipfsHash = pinataResponse.data.IpfsHash;

        // Check if the IPFS hash exists in the database
        const hashExists = await Hash.findOne({ hash: ipfsHash });

        if (!hashExists) {
            return res.render('verify', { verificationMessage: "Not Verified" });
        }

        return res.render('verify', { verificationMessage: "Verified" });

    } catch (error) {
        console.error('Error uploading or verifying the file:', error);
        return res.status(500).send('Error uploading or verifying the file on route verify');
    }
});

// Function to calculate file hash
function calculateFileHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.redirect('/');
    });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
