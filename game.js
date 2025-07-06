const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Utils
const argFact = (compareFn) => (array) => array.map((el, idx) => [el, idx]).reduce(compareFn)[1]
const argMax = argFact((min, el) => (el[0] > min[0] ? el : min))
const argMin = argFact((max, el) => (el[0] < max[0] ? el : max))
// https://docs.vultr.com/javascript/examples/get-random-item-from-an-array
const getRandomItem = arr => arr[Math.floor(Math.random() * arr.length)];

// Constants for better physics tuning
const PHYSICS = {
	GRAVITY: 0.5,
	JUMP_FORCE: -15,
	WORLD_BOTTOM: 600,
};

let lastGameStateHash = '';
let gameState = {
	player: {
		x: 200,
		y: 400,
		width: 30,
		height: 30,
		color: '#00ff00',
		velocityY: 0,
		velocityX: 5,
		jumpHeight: 0,
		name: '',
		score: 0,
		highestY: 400
	},
	peers: {},
	platforms: [],
	monsters: [],
	items: [],
	gameOver: false,
	camera: {
		x: 0,
		y: 0  // Camera's global Y position
	}
};

// To limit the fps!
let currentTime = window.performance.now();
let lastFrameTime = 0;
const targetFrameTime = 1000 / 60;

let peer = null;
let hostConnection = null;
let playerConnections = new Map();
let isHost = false;
let hostPeerId = null;
let keys = {};

// Session management (keeping most of the original networking code)
function initSession() {
	peer = new Peer();

	isHost = true;
	hostPeerId = peer.id;

	document.getElementById("sessionInfo").style.display = "block";
	document.getElementById("myPeerId").textContent = hostPeerId;
	document.getElementById("itemsPanel").style.display = "none";

	peer.on("open", (id) => {
		console.log("My peer ID is:", id);
		document.getElementById("myPeerId").textContent = id;
	});

	peer.on("connection", (conn) => {
		if (isHost) {
			conn.on("open", () => {
				console.debug(`New peer connected:`, conn.peer);
				playerConnections.set(conn.peer, conn);
			});

			conn.on("data", (message) => {
				if (message.type === "joinSession") {
					// Send current game state to new player
					conn.send({
						type: "sessionJoined",
						data: {
							gameState: gameState,
						},
					});

					// Notify all other players
					broadcast(
						{
							type: "playerJoined",
							data: {playerId: message.data.peerId},
						},
						conn.peer
					);

					document.getElementById("itemsPanel").style.display = "block";
				} else if (message.type === "peerStateUpdate") {
					const data = message.data
					const {player} = data
					gameState.peers[player.peerId] = player;
				} else if (message.type === "useItem") {
					const data = message.data;
					if (isHost) {
						handleItem(data)
					}
				}
			});

			conn.on("close", () => {
				playerConnections.delete(conn.peer);
				delete gameState.peers[conn.peer];
			});
		}
	});
}

function joinSession() {
	const hostPeerId = document.getElementById("hostPeerIdInput").value.trim();

	isHost = false;
	hostConnection = peer.connect(hostPeerId);

	document.getElementById("itemsPanel").style.display = "block";
	document.getElementById("gameControls").style.display = "block";

	hostConnection.on("open", () => {
		hostConnection.send({
			type: "joinSession",
			data: {peerId: peer.id},
		});

		document.getElementById("sessionInfo").style.display = "block";
	});

	hostConnection.on("data", (message) => {
		switch (message.type) {
			case "sessionJoined":
				Object.assign(gameState, {
					platforms: message.data.gameState.platforms,
					monsters: message.data.gameState.monsters,
				});
				break;
			case "gameStateUpdate":
				// Simple update - all positions are global
				const filteredPeers = {};
				message.data.peers.forEach(player => {
					if (player.peerId !== peer.id) {
						filteredPeers[player.peerId] = player;
					}
				});

				gameState.peers = filteredPeers;
				gameState.platforms = message.data.platforms;
				gameState.monsters = message.data.monsters;
				break;
		}
	});
}

function broadcast(message, excludePeerId = null) {
	playerConnections.forEach((conn, peerId) => {
		if (peerId !== excludePeerId) {
			conn.send(message);
		}
	});
}

// Game functions
function computeJumpHeight() {
	let x;
	for (x = 0; x < 1000; x++) {
		if (PHYSICS.JUMP_FORCE + PHYSICS.GRAVITY * x === 0) {
			gameState.player.jumpHeight = Math.abs(
				PHYSICS.JUMP_FORCE * x + (PHYSICS.GRAVITY / 2) * x * x
			);
			break;
		}
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
			jumpHeight: 0,
			color: '#00ff00',
			score: 0,
			highestY: 400
		},
		peers: {},
		platforms: [],
		monsters: [],
		items: [],
		gameOver: false,
		camera: {
			x: 0,
			y: 0
		}
	};

	computeJumpHeight();

	// Generate initial platforms with global Y coordinates
	for (let i = 0; i < 10; i++) {
		const platformX = Math.random() * (canvas.width - 80);
		gameState.platforms.push({
			x: platformX,
			y: 400 - (i * 60),  // Global Y position going upward
			originX: platformX,
			width: 80,
			height: 10,
			broken: false,
		});
	}

	// Ground platform
	gameState.platforms.push({
		x: gameState.player.x - gameState.player.width / 2,
		y: PHYSICS.WORLD_BOTTOM - 20,
		width: 80,
		height: 10,
		broken: false,
	});
}

// Initialize game
function initGame() {
	resetGame();

	// Key controls
	document.addEventListener("keydown", (e) => (keys[e.key] = true));
	document.addEventListener("keyup", (e) => (keys[e.key] = false));

	// Button controls
	document.getElementById("gameControls").style.display = "block";
	document.getElementById("gameControlLeft").addEventListener("pointerdown", (e) => {
		keys['ArrowLeft'] = true;
	});
	document.getElementById("gameControlLeft").addEventListener("pointerup", (e) => {
		keys['ArrowLeft'] = false;
	});
	document.getElementById("gameControlRight").addEventListener("pointerdown", (e) => {
		keys['ArrowRight'] = true;
	});
	document.getElementById("gameControlRight").addEventListener("pointerup", (e) => {
		keys['ArrowRight'] = false;
	});

	// Buttons
	document.getElementById("startBtn").addEventListener("click", resetGame);
	document.getElementById("joinBtn").addEventListener("click", joinSession);

	// Item buttons
	document.querySelectorAll(".item-button").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			const item = e.target.getAttribute("data-item");
			if (btn.classList.contains("item-cooldown")) {
				return;
			}

			useItem(item);

			// Cooldown
			btn.classList.add("item-cooldown");
			setTimeout(() => {
				btn.classList.remove("item-cooldown");
			}, 1000);
		});
	});
}

function useItem(itemType) {
	const data = {
		item: itemType,
		position: {
			x: Math.random() * canvas.width,
			y: gameState.camera.y,
		},
	}

	if (!isHost && hostConnection) {
		hostConnection.send({
			type: "useItem",
			data: data
		});
	} else {
		handleItem(data)
	}
}

function handleItem(data) {
	let randomPlayer = gameState.player
	if (Math.random() > 0.5) {
		randomPlayer = getRandomItem(gameState.peers);
	}

	switch (data.item) {
		case "bomb":
			// Remove nearby platforms
			gameState.platforms.forEach((platform) => {
				if (Math.abs(platform.x - data.position.x) < 100) {
					platform.broken = true;
				}
			});
			break;
		case "monster":
			// Spawn a monster
			gameState.monsters.push({
				x: data.position.x,
				y: 0,
				velocityY: 2,
			});
			break;
		case "break":
			// Break a random platform
			const randomPlatform =
				gameState.platforms[
					Math.floor(Math.random() * gameState.platforms.length)
					];
			if (randomPlatform) randomPlatform.broken = true;
			break;
		case "wind":
			randomPlayer.x += (Math.random() - 0.5) * 100;
			break;
		case "teleport":
			// Teleport the player on top of the screen
			randomPlayer.y = (Math.random() - 0.5) * 100;
	}
}

// Game loop
function gameLoop() {
	currentTime = window.performance.now();
	const deltaTime = currentTime - lastFrameTime;

	if (deltaTime >= targetFrameTime) {
		lastFrameTime = currentTime - (deltaTime % targetFrameTime);

		if (!gameState.gameOver) {
			update();

			const currentStateHash = JSON.stringify({
				player: `${gameState.player.x},${gameState.player.y}`,
				platforms: gameState.platforms.length,
				monsters: gameState.monsters.length,
				score: gameState.player.score
			});

			if (currentStateHash !== lastGameStateHash) {
				if (isHost) {
					const allPlayers = [
						...Object.values(gameState.peers),
						{
							x: gameState.player.x,
							y: gameState.player.y,
							name: gameState.player.name,
							peerId: peer.id,
							score: gameState.player.score,
							gameOver: gameState.gameOver,
						},
					];

					broadcast({
						type: "gameStateUpdate",
						data: {
							peers: allPlayers,
							platforms: gameState.platforms,
							monsters: gameState.monsters,
						},
					});
				} else if (hostConnection) {
					hostConnection.send({
						type: "peerStateUpdate",
						data: {
							player: {
								x: gameState.player.x,
								y: gameState.player.y,
								name: gameState.player.name,
								peerId: peer.id,
								score: gameState.player.score,
								gameOver: gameState.gameOver,
							},
						},
					});
				}
				lastGameStateHash = currentStateHash;
			}
		}
		render();
	}

	requestAnimationFrame(gameLoop);
}

// Update game
function update() {
	const player = gameState.player;

	// Player movement
	if (keys["ArrowLeft"] || keys["a"]) {
		player.x -= player.velocityX;
	}
	if (keys["ArrowRight"] || keys["d"]) {
		player.x += player.velocityX;
	}

	// Keep player on screen horizontally
	if (player.x < 0) player.x = canvas.width;
	if (player.x > canvas.width) player.x = 0;

	// Apply gravity
	player.velocityY += PHYSICS.GRAVITY;
	player.y += player.velocityY;

	// Update score based on highest position reached
	if (player.y < player.highestY) {
		const heightGained = player.highestY - player.y;
		player.score += Math.round(heightGained);
		player.highestY = player.y;
	}

	// Collision detection
	checkCollision();

	// Moving platforms
	updatePlatforms();

	// Update camera to follow player
	updateCamera();

	// Generate new platforms only if host
	if (isHost) {
		generatePlatforms();
		cleanupOldObjects();
	}

	// Check game over
	if (player.y > PHYSICS.WORLD_BOTTOM) {
		gameState.gameOver = true;
	}
}

function updateCamera() {
	const player = gameState.player;

	// Camera follows player vertically, centered at canvas height / 2
	if (player.y < gameState.camera.y + canvas.height / 2 || player.y - gameState.camera.y > canvas.height / 0.99) {
		gameState.camera.y = player.y - canvas.height / 2;
	}

	// Optional: Prevent camera from going below ground level
	if (gameState.camera.y > PHYSICS.WORLD_BOTTOM - canvas.height) {
		gameState.camera.y = PHYSICS.WORLD_BOTTOM - canvas.height;
	}
}

function checkCollision() {
	const player = gameState.player;

	for (let i = 0, l = gameState.platforms.length; i < l; i++) {
		const platform = gameState.platforms[i];
		if (platform.broken) continue;

		// Only check platforms near the player
		if (Math.abs(platform.y - player.y) > 100) continue;

		if (player.velocityY > 0 &&
			player.y + player.height > platform.y &&
			player.y + player.height < platform.y + platform.height + player.velocityY &&
			player.x + player.width > platform.x &&
			player.x < platform.x + platform.width) {

			player.y = platform.y - player.height;
			player.velocityY = PHYSICS.JUMP_FORCE;
			return;
		}
	}
}

function updatePlatforms() {
	for (let i = 0, l = gameState.platforms.length; i < l; i++) {
		const platform = gameState.platforms[i];
		if (platform.moving) {
			if (
				(platform.moveSpeed > 0 &&
					platform.x >= platform.originX + platform.moveRange / 2) ||
				(platform.moveSpeed < 0 &&
					platform.x < platform.originX - platform.moveRange / 2) ||
				platform.x <= 0 ||
				platform.x > canvas.width
			) {
				platform.moveSpeed = -platform.moveSpeed;
			}
			platform.x += platform.moveSpeed;
		}
	}
}

function generatePlatforms() {
	// Find the highest platform
	let highestPlatformY = Math.min(...gameState.platforms.map((p) => p.y));

	const highestPeer = Math.min(...Object.values(gameState.peers).filter(p => !p.gameOver).map((p) => p.y), gameState.camera.y);
	const spacing = Math.max(-40, -Math.sqrt(gameState.player.score) * 0.2);

	// Generate new platforms above the highest one
	while (highestPlatformY > highestPeer) {
		const jumpHeight = gameState.player.jumpHeight;
		const platformSpacing = Math.random() * (jumpHeight * 0.6) - spacing;

		highestPlatformY -= platformSpacing;

		const platformX = Math.random() * (canvas.width - 80);
		gameState.platforms.push({
			x: platformX,
			y: highestPlatformY,
			width: 80,
			height: 10,
			broken: false,
			moving: Math.random() < 0.3,
			moveSpeed: (Math.random() - 0.5) * 5,
			originX: platformX,
			moveRange: Math.random() * 100 + 100,
		});
	}
}

function cleanupOldObjects() {
	const lowestPeer = Math.max(...Object.values(gameState.peers).filter(p => !p.gameOver).map((p) => p.y), gameState.camera.y);

	// Remove platforms that are too far below the camera
	gameState.platforms = gameState.platforms.filter(
		(p) => p.y < lowestPeer + canvas.height + 200
	);

	// Remove monsters that are too far away
	gameState.monsters = gameState.monsters.filter(
		(m) => m.y < lowestPeer + canvas.height + 200
	);
}

function render() {
	// Clear canvas
	ctx.fillStyle = "#87CEEB";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Save context state
	ctx.save();

	// Apply camera transformation
	ctx.translate(0, -gameState.camera.y);

	// Draw all platforms in world space
	ctx.fillStyle = "#8B4513";
	gameState.platforms.forEach((platform) => {
		if (!platform.broken &&
			platform.y > gameState.camera.y - 50 &&
			platform.y < gameState.camera.y + canvas.height + 50) {
			ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
		}
	});

	// Draw broken platforms
	ctx.fillStyle = "rgba(71,61,55,0.36)";
	gameState.platforms.forEach((platform) => {
		if (platform.broken &&
			platform.y > gameState.camera.y - 50 &&
			platform.y < gameState.camera.y + canvas.height + 50) {
			ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
		}
	});

	// Draw monsters
	ctx.fillStyle = "#FF0000";
	gameState.monsters.forEach((monster) => {
		if (monster.y > gameState.camera.y - 50 &&
			monster.y < gameState.camera.y + canvas.height + 50) {
			ctx.beginPath();
			ctx.arc(monster.x, monster.y, 15, 0, Math.PI * 2);
			ctx.fill();
		}
	});

	// Draw player
	ctx.fillStyle = gameState.player.color;
	ctx.fillRect(
		gameState.player.x,
		gameState.player.y,
		gameState.player.width,
		gameState.player.height
	);

	// Draw peers
	for (const peer of Object.values(gameState.peers)) {
		ctx.fillStyle = '#ff0000';
		ctx.fillRect(
			peer.x,
			peer.y,
			gameState.player.width,
			gameState.player.height
		);

		// Draw peer name and score
		ctx.fillStyle = "#000000";
		ctx.font = "12px Arial";
		ctx.fillText(
			`${peer.name || 'Player'} (${peer.score || 0})`,
			peer.x - 20,
			peer.y - 5
		);
	}

	// Restore context state (removes camera transformation)
	ctx.restore();

	// Draw UI elements (not affected by camera)
	ctx.fillStyle = "#000000";
	ctx.font = "20px Arial";
	ctx.fillText(`Score: ${gameState.player.score}`, 10, 30);
	ctx.fillText(`Height: ${-Math.round(gameState.player.y)}m`, 10, 55);

	// Draw leaderboard
	const allPlayers = [
		{name: gameState.player.name || 'You', score: gameState.player.score},
		...Object.values(gameState.peers).map(p => ({
			name: p.name || `Player ${p.peerId.slice(0, 4)}`,
			score: p.score || 0
		}))
	];

	allPlayers.sort((a, b) => b.score - a.score);

	ctx.font = "14px Arial";
	ctx.fillText("Leaderboard:", canvas.width - 150, 30);
	allPlayers.slice(0, 5).forEach((player, index) => {
		ctx.fillText(
			`${index + 1}. ${player.name}: ${player.score}`,
			canvas.width - 150,
			50 + index * 20
		);
	});

	// Draw game over
	if (gameState.gameOver) {
		ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "#FFFFFF";
		ctx.font = "40px Arial";
		ctx.fillText("Game Over!", canvas.width / 2 - 100, canvas.height / 2);
		ctx.font = "20px Arial";
		ctx.fillText(
			`Final Score: ${gameState.player.score}`,
			canvas.width / 2 - 70,
			canvas.height / 2 + 40
		);
	}
}

// Initialize and start game
initSession();
initGame();
gameLoop();
