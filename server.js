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
app.use(express.static('public'));

// In-memory storage (replace with database in production)
const sessions = new Map();
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

// Socket.io events
io.on('connection', (socket) => {
	console.log('New client connected:', socket.id);

	socket.on('createSession', (data) => {
		const sessionId = Math.random().toString(36).substring(7);
		sessions.set(sessionId, {
			host: socket.id,
			players: [socket.id],
			gameState: data.gameState
		});
		socket.join(sessionId);
		socket.emit('sessionCreated', { sessionId });
	});

	socket.on('joinSession', (data) => {
		const { sessionId } = data;
		const session = sessions.get(sessionId);

		if (session) {
			session.players.push(socket.id);
			socket.join(sessionId);
			socket.emit('sessionJoined', { sessionId, isHost: false });
			io.to(sessionId).emit('playerJoined', { playerId: socket.id });
		} else {
			socket.emit('error', { message: 'Session not found' });
		}
	});

	socket.on('gameUpdate', (data) => {
		const { sessionId, gameState } = data;
		const session = sessions.get(sessionId);

		if (session && session.host === socket.id) {
			session.gameState = gameState;
			socket.to(sessionId).emit('gameStateUpdate', { gameState });
		}
	});

	socket.on('useItem', (data) => {
		const { sessionId, item, position } = data;
		io.to(sessionId).emit('itemUsed', { item, position, userId: socket.id });
	});

	socket.on('disconnect', () => {
		console.log('Client disconnected:', socket.id);
		// Clean up sessions
		sessions.forEach((session, sessionId) => {
			if (session.host === socket.id) {
				io.to(sessionId).emit('sessionEnded');
				sessions.delete(sessionId);
			} else {
				const index = session.players.indexOf(socket.id);
				if (index > -1) {
					session.players.splice(index, 1);
				}
			}
		});
	});
});

server.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
