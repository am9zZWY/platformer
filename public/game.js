const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const socket = io();

// Constants for better physics tuning
const PHYSICS = {
	GRAVITY: 0.5,
	JUMP_FORCE: -15,
	CAMERA_THRESHOLD: canvas.height / 2
};

let currentUser = null;
let gameState = {
	player: {
		x: 200,
		y: 400,
		width: 30,
		height: 30,
		velocityY: 0,
		velocityX: 5,
		isJumping: false,
		jumpHeight: 0
	},
	platforms: [],
	monsters: [],
	items: [],
	score: 0,
	gameOver: false,
	cameraY: 0
};

let sessionId = null;
let isHost = false;
let keys = {};

function computeJumpHeight() {
	let x;
	for (x = 0; x < 1000; x++) {
		if (PHYSICS.JUMP_FORCE + PHYSICS.GRAVITY * x === 0) {
			gameState.player.jumpHeight = Math.abs((PHYSICS.JUMP_FORCE * x) + ((PHYSICS.GRAVITY / 2) * x * x));
			break;
		}
	}
}

// Google Sign-In callback
window.handleCredentialResponse = async (response) => {
	try {
		const res = await fetch('/api/auth/google', {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({token: response.credential})
		});

		const data = await res.json();
		if (data.success) {
			currentUser = data.user;
			updateUserUI();
		}
	} catch (error) {
		console.error('Authentication error:', error);
	}
};

function updateUserUI() {
	const loginPanel = document.getElementById('loginPanel');
	const userInfo = document.getElementById('userInfo');

	if (currentUser) {
		loginPanel.style.display = 'none';
		userInfo.style.display = 'block';
		userInfo.innerHTML = `
            <img src="${currentUser.picture}" alt="Avatar" class="user-avatar">
            <span>Welcome, ${currentUser.name}!</span>
        `;
	}
}

function resetGame() {
	gameState = {
		player: {
			x: 200,
			y: 400,
			width: 30,
			height: 30,
			velocityY: 0,
			velocityX: 5,
			isJumping: false,
			jumpHeight: 0
		},
		platforms: [],
		monsters: [],
		items: [],
		score: 0,
		gameOver: false,
		cameraY: 0
	};

	computeJumpHeight();

	// Generate initial platforms
	for (let i = 0; i < 10; i++) {
		const platformX = Math.random() * (canvas.width - 80)
		gameState.platforms.push({
			x: platformX,
			y: i * 60,
			originX: platformX,
			width: 80,
			height: 10,
			broken: false
		});
	}

	gameState.platforms.push({
		x: gameState.player.x - gameState.player.width / 2,
		y: canvas.height - 20,
		width: 80,
		height: 10,
		broken: false
	});
}

// Initialize game
function init() {
	resetGame();

	// Event listeners
	document.addEventListener('keydown', (e) => keys[e.key] = true);
	document.addEventListener('keyup', (e) => keys[e.key] = false);


	document.getElementById('startBtn').addEventListener('click', startNewGame);
	document.getElementById('joinBtn').addEventListener('click', joinSession);

	// Item buttons
	document.querySelectorAll('.item-button').forEach(btn => {
		btn.addEventListener('click', (e) => {
			const item = e.target.getAttribute('data-item');
			if (btn.classList.contains('item-cooldown')) {
				return;
			}

			useItem(item);

			// Cooldown
			btn.classList.add('item-cooldown');
			setTimeout(() => {
				btn.classList.remove('item-cooldown');
			}, 1000)
		});
	});

	loadHighScores();
}

function startNewGame() {
	resetGame();
	socket.emit('createSession', {gameState});
	isHost = true;
	document.getElementById('itemsPanel').style.display = 'none';
}

function joinSession() {
	const inputSessionId = document.getElementById('sessionInput').value.trim();
	if (inputSessionId && inputSessionId !== sessionId) {
		sessionId = inputSessionId;
		socket.emit('joinSession', {sessionId});
		isHost = false;
		document.getElementById('itemsPanel').style.display = 'block';
	}
}

function useItem(itemType) {
	if (!isHost && sessionId) {
		socket.emit('useItem', {
			sessionId,
			item: itemType,
			position: {x: Math.random() * canvas.width, y: gameState.cameraY}
		});
	}
}

// Game loop
function gameLoop() {
	if (isHost && !gameState.gameOver) {
		update();
		render();

		// Send game state to spectators
		if (sessionId) {
			socket.emit('gameUpdate', {sessionId, gameState});
		}

	} else if (!isHost) {
		// Spectators just render the received game state
		render();
	}

	requestAnimationFrame(gameLoop);
}

async function update() {
	const player = gameState.player;

	// Player movement
	if (keys['ArrowLeft'] || keys['a']) {
		player.x -= player.velocityX;
	}
	if (keys['ArrowRight'] || keys['d']) {
		player.x += player.velocityX;
	}

	// Keep player on screen
	if (player.x < 0) player.x = canvas.width;
	if (player.x > canvas.width) player.x = 0;

	// Apply gravity
	player.velocityY += PHYSICS.GRAVITY;
	player.y += player.velocityY;

	// Platform collision detection
	gameState.platforms.forEach(platform => {
		if (!platform.broken &&
			player.velocityY > 0 && // Only when falling
			player.y + player.height > platform.y &&
			player.y + player.height < platform.y + platform.height + player.velocityY &&
			player.x + player.width > platform.x &&
			player.x < platform.x + platform.width) {

			// Land on platform
			player.y = platform.y - player.height;
			player.velocityY = PHYSICS.JUMP_FORCE;
		}
	});

	// Moving platforms
	gameState.platforms = gameState.platforms.map(platform => {
			if (platform.moving) {
				if ((platform.moveSpeed > 0 && platform.x >= platform.originX + platform.moveRange / 2) || (platform.moveSpeed < 0 && platform.x < platform.originX - platform.moveRange / 2) || platform.x <= 0 || platform.x > canvas.width) {
					// Switch only if it hit the moveRange / 2 or the border of the canvas
					platform.moveSpeed = -platform.moveSpeed;
				}
				platform.x += platform.moveSpeed;
			}
			return platform
		}
	)

	// Camera follow with smooth scrolling
	if (player.y < PHYSICS.CAMERA_THRESHOLD) {
		const diff = PHYSICS.CAMERA_THRESHOLD - player.y;
		gameState.cameraY += diff;
		player.y = PHYSICS.CAMERA_THRESHOLD;

		// Score
		gameState.score += Math.round(diff);

		// Move all objects down
		gameState.platforms.forEach(platform => {
			platform.y += diff;
		});

		gameState.monsters.forEach(monster => {
			monster.y += diff;
		});

		// Generate new platforms based on camera position
		generatePlatforms();
	}

	// Check game over
	if (player.y > canvas.height) {
		gameState.gameOver = true;
		await saveHighScore();
	}
}

function generatePlatforms() {
	// Remove platforms that are below the screen
	gameState.platforms = gameState.platforms.filter(p => p.y < canvas.height + 100);

	// Calculate the highest platform
	let highestPlatformY = Math.min(...gameState.platforms.map(p => p.y));

	const spacing = Math.max(-40, -Math.sqrt(gameState.score) * 0.2)

	// Generate new platforms above the screen
	while (highestPlatformY > -200) {
		const jumpHeight = gameState.player.jumpHeight; // Maximum jump height
		const platformSpacing = Math.random() * (jumpHeight * 0.6) - spacing;

		highestPlatformY -= platformSpacing;

		const platformX = Math.random() * (canvas.width - 80)
		gameState.platforms.push({
			x: platformX,
			y: highestPlatformY,
			width: 80,
			height: 10,
			broken: false,

			moving: Math.random() < 0.3,
			moveSpeed: (Math.random() - 0.5) * 5,
			originX: platformX, // needed for moving platforms
			moveRange: 200
		});
	}
}

function generateMonsters() {
	// Remove monsters that are below the screen
	gameState.monsters = gameState.monsters.filter(m => m.y < canvas.height + 100);


}

function render() {
	// Clear canvas
	ctx.fillStyle = '#87CEEB';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Draw platforms
	gameState.platforms.forEach(platform => {
		if (!platform.broken) {
			ctx.fillStyle = '#8B4513';
		} else {
			ctx.fillStyle = 'rgba(71,61,55,0.36)';
		}
		ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
	});

	// Draw monsters
	ctx.fillStyle = '#FF0000';
	gameState.monsters.forEach(monster => {
		ctx.beginPath();
		ctx.arc(monster.x, monster.y, 15, 0, Math.PI * 2);
		ctx.fill();
	});

	// Draw player
	ctx.fillStyle = '#00FF00';
	ctx.fillRect(gameState.player.x, gameState.player.y,
		gameState.player.width, gameState.player.height);

	// Draw score
	ctx.fillStyle = '#000000';
	ctx.font = '20px Arial';
	ctx.fillText(`Score: ${gameState.score}`, 10, 30);

	// Draw game over
	if (gameState.gameOver) {
		ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#FFFFFF';
		ctx.font = '40px Arial';
		ctx.fillText('Game Over!', canvas.width / 2 - 100, canvas.height / 2);
		ctx.font = '20px Arial';
		ctx.fillText(`Final Score: ${gameState.score}`, canvas.width / 2 - 70, canvas.height / 2 + 40);
	}
}

async function saveHighScore() {
	if (currentUser && gameState.score > 0) {
		try {
			await fetch('/api/highscores', {
				method: 'POST',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({
					playerName: currentUser.name,
					score: gameState.score
				})
			});
			loadHighScores();
		} catch (error) {
			console.error('Error saving high score:', error);
		}
	}
}

async function loadHighScores() {
	try {
		const response = await fetch('/api/highscores');
		const scores = await response.json();

		const scoresList = document.getElementById('scoresList');
		scoresList.innerHTML = scores.map((score, index) => `
            <div class="score-item">
                ${index + 1}. ${score.playerName} - ${score.score}
            </div>
        `).join('');
	} catch (error) {
		console.error('Error loading high scores:', error);
	}
}

// Socket event handlers
socket.on('sessionCreated', (data) => {
	sessionId = data.sessionId;
	document.getElementById('sessionInfo').style.display = 'block';
	document.getElementById('sessionId').textContent = sessionId;
});

socket.on('sessionJoined', (data) => {
	sessionId = data.sessionId;
	document.getElementById('sessionInfo').style.display = 'block';
	document.getElementById('sessionId').textContent = sessionId;
});

socket.on('gameStateUpdate', (data) => {
	if (!isHost) {
		gameState = data.gameState;
	}
});

socket.on('itemUsed', (data) => {
	if (isHost) {
		switch (data.item) {
			case 'bomb':
				// Remove nearby platforms
				gameState.platforms.forEach(platform => {
					if (Math.abs(platform.x - data.position.x) < 100) {
						platform.broken = true;
					}
				});
				break;
			case 'monster':
				// Spawn a monster
				gameState.monsters.push({
					x: data.position.x,
					y: 0,
					velocityY: 2
				});
				break;
			case 'break':
				// Break a random platform
				const randomPlatform = gameState.platforms[
					Math.floor(Math.random() * gameState.platforms.length)
					];
				if (randomPlatform) randomPlatform.broken = true;
				break;
			case 'wind':
				// Push player sideways
				gameState.player.x += (Math.random() - 0.5) * 100;
				break;
			case 'teleport':
				// Teleport the player on top of the screen
				gameState.player.y = (Math.random() - 0.5) * 100;
		}
	}
});

// Initialize and start game
init();
gameLoop();
