// // server.js
// const express = require("express");
// const http = require("http");
// const mongoose = require("mongoose");
// const { Server } = require("socket.io");
// const cors = require("cors");
// const ACTIONS = require("./src/Actions");
// const router = express.Router();
// const bcrypt = require("bcryptjs");
// const jwt = require("jsonwebtoken");
// const app = express();

// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:3030", // Replace with the actual origin of your client application
//     methods: ["GET", "POST"],
//     allowedHeaders: ["my-custom-header"],
//     credentials: true,
//   },
// });



// // app.get("/sfs",(req,res)=>{
// //     res.send("ssfsfs")
// // })
// // router.route("/signup").post(createuser);
// // router.route("/login").post(loginUser);

// const ChatMessage = mongoose.model("ChatMessage", {
//   username: String,
//   message: String,
// });

// const userSocketMap = {};

// function getAllConnectedClients(roomId) {
//   return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
//     (socketId) => {
//       return {
//         socketId,
//         username: userSocketMap[socketId],
//       };
//     }
//   );
// }

// io.on("connection", (socket) => {
//   console.log("socket connected", socket.id);

//   socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
//     userSocketMap[socket.id] = username;
//     socket.join(roomId);
//     const clients = getAllConnectedClients(roomId);
//     clients.forEach(({ socketId }) => {
//       io.to(socketId).emit(ACTIONS.JOINED, {
//         clients,
//         username,
//         socketId: socket.id,
//       });
//     });
//   });

//   socket.on(ACTIONS.SEND_MESSAGE, ({ roomId, message }) => {
//     const senderUsername = userSocketMap[socket.id];
//     const chatMessage = new ChatMessage({ senderUsername, message });
//     chatMessage.save();
//     io.in(roomId).emit(ACTIONS.RECEIVE_MESSAGE, {
//       username: senderUsername,
//       message,
//     });
//   });

//   socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
//     socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
//   });

//   socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
//     io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
//   });

//   socket.on(ACTIONS.TOGGLE_EDITOR_LOCK, ({ roomId, editorLocked }) => {
//     // Emit the new TOGGLE_EDITOR_LOCK action to other users in the room
//     socket.to(roomId).emit(ACTIONS.TOGGLE_EDITOR_LOCK, { editorLocked });
//   });

//   // Handle UPLOAD_FILE event on the server side
//   socket.on("UPLOAD_FILE", ({ roomId, fileContent }) => {
//     // Broadcast the file content to all participants in the room
//     io.to(roomId).emit("SYNC_CODE", { code: fileContent });
//   });

//   socket.on("disconnecting", () => {
//     const rooms = [...socket.rooms];
//     rooms.forEach((roomId) => {
//       socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
//         socketId: socket.id,
//         username: userSocketMap[socket.id],
//       });
//     });
//     delete userSocketMap[socket.id];
//     socket.leave();
//   });
// });

// const PORT = process.env.PORT || 5050;
// server.listen(PORT, () => console.log(`Listening on port ${PORT}`));



const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ACTIONS = require("./src/Actions");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3030", // Replace with the actual origin of your client application
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true,
  },
});

app.use(express.json());
app.use(cors());

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await User.findOne({ username });
      if (!user) return done(null, false, { message: "Invalid username" });

      const validPass = await bcrypt.compare(password, user.password);
      if (!validPass) return done(null, false, { message: "Invalid password" });

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id, (err, user) => {
    done(err, user);
  });
});

// Express session
app.use(
  session({
    secret: "your-secret-key",
    resave: true,
    saveUninitialized: true,
  })
);

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

mongoose.connect("mongodb+srv://syntexity:syntexity@cluster0.kqn8npq.mongodb.net")
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("Error connecting to MongoDB:", err));

const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
});
const User = mongoose.model("user", UserSchema);

const createuser = async (req, res) => {
  const emailExists = await User.findOne({ email: req.body.email });

  if (emailExists) return res.status(400).send("Email already exists");

  const usernameExists = await User.findOne({ username: req.body.username });

  if (usernameExists) return res.status(400).send("Username already exists");

  const salt = await bcrypt.genSalt(10);
  const hashPassword = await bcrypt.hash(req.body.password, salt);

  const hasheduser = new User({
    username: req.body.username.toUpperCase(),
    email: req.body.email,
    password: hashPassword,
  });

  try {
    const saveduser = await User.create(hasheduser);
    res.status(201).json(saveduser);
  } catch (error) {
    res.status(500).json({ msg: error });
  }
};

const loginUser = (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(400).send(info.message);

    req.logIn(user, (err) => {
      if (err) return next(err);
      const token = jwt.sign({ name: user.username }, "sfsfs");
      return res.send({ token: token });
    });
  })(req, res, next);
};

const ChatMessage = mongoose.model("ChatMessage", {
  username: String,
  message: String,
});

const userSocketMap = {};

function getAllConnectedClients(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
      };
    }
  );
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.SEND_MESSAGE, ({ roomId, message }) => {
    const senderUsername = userSocketMap[socket.id];
    const chatMessage = new ChatMessage({ senderUsername, message });
    chatMessage.save();
    io.in(roomId).emit(ACTIONS.RECEIVE_MESSAGE, {
      username: senderUsername,
      message,
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.TOGGLE_EDITOR_LOCK, ({ roomId, editorLocked }) => {
    // Emit the new TOGGLE_EDITOR_LOCK action to other users in the room
    socket.to(roomId).emit(ACTIONS.TOGGLE_EDITOR_LOCK, { editorLocked });
  });

  // Handle UPLOAD_FILE event on the server side
  socket.on("UPLOAD_FILE", ({ roomId, fileContent }) => {
    // Broadcast the file content to all participants in the room
    io.to(roomId).emit("SYNC_CODE", { code: fileContent });
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    socket.leave();
  });
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));

const router = express.Router();
router.route("/signup").post(createuser);
router.route("/login").post(loginUser);
app.use("/api", router);
