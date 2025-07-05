const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"]
	}
});

const PORT = process.env.PORT || 3000;
const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID'; // Replace with your Google OAuth client ID
const client = new OAuth2Client(CLIENT_ID);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/', express.static(__dirname, {index: 'index.html'}));

// In-memory storage (replace with database in production)
const highScores = [];
const users = new Map();

// API Routes
app.post('/api/auth/google', async (req, res) => {
	try {
		const { token } = req.body;
		const ticket = await client.verifyIdToken({
			idToken: token,
			audience: CLIENT_ID
		});
		const payload = ticket.getPayload();
		const userId = payload['sub'];

		users.set(userId, {
			id: userId,
			email: payload['email'],
			name: payload['name'],
			picture: payload['picture']
		});

		res.json({ success: true, user: users.get(userId) });
	} catch (error) {
		res.status(401).json({ success: false, error: 'Invalid token' });
	}
});

app.get('/api/highscores', (req, res) => {
	res.json(highScores.toSorted((a, b) => b.score - a.score).slice(0, 10));
});

app.post('/api/highscores', (req, res) => {
	const { playerName, score } = req.body;
	highScores.push({ playerName, score, date: new Date() });
	res.json({ success: true });
});

server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
