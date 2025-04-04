const OpenAI=require("openai");  
const { HfInference } = require('@huggingface/inference');
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
const { default: axios } = require("axios");
require('dotenv').config(); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Replace with the actual origin of your client application
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

mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

const UserSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
});
const ChatMessage = mongoose.model("ChatMessage", {
  username: String,
  message: String,
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

const loginUser = async (req, res) => {
  const user = await User.findOne({
    username: req.body.username.toUpperCase(),
  });
  if (!user) return res.status(400).send("Invalid username");

  const validPass = await bcrypt.compare(req.body.password, user.password);
  if (!validPass) return res.status(400).send("Invalid password");

  const token = jwt.sign({ name: user.username }, "sfsfs");
  try {
    res.send({ token: token });
  } catch (error) {
    res.send("Incorrect login details");
  }
};



const userSocketMap = {};
const roomTabs = new Map(); // Store tabs and their content for each room


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
let userChanges = {};


io.on("connection", (socket) => {
  console.log("socket connected", socket.id);
  // socket.on("keep-alive", () => {
  //   console.log("Received keep-alive message from client:", socket.id);
  // });
  userChanges={};

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
     // Send existing tabs to the new user
     if (roomTabs.has(roomId)) {
      socket.emit(ACTIONS.SYNC_TABS, roomTabs.get(roomId));
    }
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

  socket.on(ACTIONS.SYNC_TABS, ({ roomId, tabs, tabContents, activeTab }) => {
    // Store the current state
    if (!roomTabs.has(roomId)) {
      roomTabs.set(roomId, new Map());
    }
    const roomTabsMap = roomTabs.get(roomId);
    
    // Update with new content
    Object.entries(tabContents).forEach(([tabId, content]) => {
      roomTabsMap.set(tabId, content);
    });
    
    // Broadcast to room
    socket.to(roomId).emit(ACTIONS.SYNC_TABS, {
      tabs,
      tabContents,
      activeTab
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId }) => {
    const senderUsername2 = userSocketMap[socket.id];
    if (!userChanges[senderUsername2]) {
      userChanges[senderUsername2] = 0;
    }
    userChanges[senderUsername2]++;
    // console.log(userChanges);
    io.in(roomId).emit(ACTIONS.USER_CHANGES, userChanges);
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });
   // Update the code change handler to include tab information
  //  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, tabId }) => {
  //   console.log("Setting code");
    
  //   if (roomTabs.has(roomId)) {
  //     const tabs = roomTabs.get(roomId);
  //     tabs.set(tabId, code);
  //   }
    
  //   socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { 
  //     code,
  //     tabId,
  //     username: userSocketMap[socket.id]
  //   });
  // });
   socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code, tabId }) => {
    if (roomTabs.has(roomId)) {
      const tabs = roomTabs.get(roomId);
      tabs.set(tabId, code);
    }
    
    // Broadcast to all users in the room
    io.in(roomId).emit(ACTIONS.CODE_CHANGE, { 
      code,
      tabId,
      username: userSocketMap[socket.id]
    });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  // socket.on(ACTIONS.TOGGLE_EDITOR_LOCK, ({ roomId, editorLocked }) => {
  //   // Emit the new TOGGLE_EDITOR_LOCK action to other users in the room
  //   socket.to(roomId).emit(ACTIONS.TOGGLE_EDITOR_LOCK, { editorLocked });
  // });
  socket.on(ACTIONS.TOGGLE_EDITOR_LOCK, ({ roomId, editorLocked }) => {
    // Get the username of the person who toggled the lock
    const username = userSocketMap[socket.id];
    
    // Emit the event with username included
    socket.to(roomId).emit(ACTIONS.TOGGLE_EDITOR_LOCK, { 
      editorLocked,
      username 
    });
  });

  // Update the tab change handler
  // socket.on(ACTIONS.TAB_CHANGE, ({ roomId, tabId, content }) => {
  //   console.log("Tab is being changed", tabId);
  //   console.log(content);
    
    
  //   // Update the tab content in our storage
  //   if (!roomTabs.has(roomId)) {
  //     roomTabs.set(roomId, new Map());
  //   }
  //   const tabs = roomTabs.get(roomId);
  //   tabs.set(tabId, content);
    
  //   // Broadcast the change to all users in the room except sender
  //   socket.in(roomId).emit(ACTIONS.TAB_CHANGE, { 
  //     tabId, 
  //     content,
  //     username: userSocketMap[socket.id]
  //   });
  // });
  socket.on(ACTIONS.TAB_CHANGE, ({ roomId, tabId, content }) => {
    // Update room tabs
    if (!roomTabs.has(roomId)) {
      roomTabs.set(roomId, new Map());
    }
    const tabs = roomTabs.get(roomId);
    tabs.set(tabId, content);
    
    // Broadcast to all users in room
    io.in(roomId).emit(ACTIONS.TAB_CHANGE, { 
      tabId, 
      content,
      username: userSocketMap[socket.id]
    });
  });
  
  socket.on(ACTIONS.NEW_TAB, ({ roomId, tab }) => {
    if (!roomTabs.has(roomId)) {
      roomTabs.set(roomId, new Map());
    }
    const tabs = roomTabs.get(roomId);
    tabs.set(tab.id, tab.content || '');
    
    socket.in(roomId).emit(ACTIONS.NEW_TAB, { 
      tab,
      username: userSocketMap[socket.id]
    });
  });
  
   // Handle tab closure
   socket.on(ACTIONS.TAB_CLOSE, ({ roomId, tabId }) => {
    if (roomTabs.has(roomId)) {
      const tabs = roomTabs.get(roomId);
      tabs.delete(tabId);
      
      socket.in(roomId).emit(ACTIONS.TAB_CLOSE, { 
        tabId,
        username: userSocketMap[socket.id]
      });
    }
  });
  // Handle UPLOAD_FILE event on the server side
  socket.on("UPLOAD_FILE", ({ roomId, fileContent }) => {
    // Broadcast the file content to all participants in the room
    io.to(roomId).emit("SYNC_CODE", { code: fileContent });
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      const clients = getAllConnectedClients(roomId);
      if (clients.length <= 1) { // If this was the last user
        roomTabs.delete(roomId); // Clean up the room's tab data
      }
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    //socket.leave();
  });
});


const PORT = process.env.PORT || 5050;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));

const router = express.Router();
router.route("/signup").post(createuser);
router.route("/login").post(loginUser);


// // Initialize Hugging Face Inference
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.post("/api/suggest-code", async (req, res) => {
//   const { codeSnippet, language } = req.body;
//   if (!codeSnippet || !language) return res.status(400).json({ error: "Code snippet and language are required." });

//   try {
//     const response = await hf.textGeneration({
//       model: "bigcode/starcoder",
//       inputs: codeSnippet,
//       parameters: { max_new_tokens: 100, temperature: 0.7, top_p: 0.9 },
//     });

//     const suggestion = response.generated_text.replace(codeSnippet, "").trim();
//     if (!suggestion) throw new Error("Failed to generate a suggestion.");

//     res.status(200).json({ suggestion });
//   } catch (error) {
//     console.error("Error generating suggestion:", error);
//     res.status(500).json({ error: error.message || "Internal server error." });
//   }
// });



// Initialize Hugging Face Inference
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

app.post("/api/suggest-code", async (req, res) => {
  const { codeSnippet, language } = req.body;

  // Validate required fields
  if (!codeSnippet || !language) {
    return res.status(400).json({ error: "Code snippet and language are required." });
  }

  try {
    const prompt=`${codeSnippet}`
    // Use Hugging Face's code generation model
    const response = await hf.textGeneration({
      model: 'bigcode/starcoder',
      inputs: prompt,
      parameters: {
        max_new_tokens: 100,
        temperature: 0.7,
        top_p: 0.9,
      }
    });

    // Extract and clean the suggestion
    const suggestion = response.generated_text.replace(prompt, '').trim();

    if (!suggestion) {
      return res.status(500).json({ error: "Failed to generate a suggestion." });
    }

    // Send the suggestion back to the client
    res.status(200).json({ suggestion });
  } catch (error) {
    // Log error for debugging
    console.error("Error generating suggestion:", error);

    // Return error response
    res.status(500).json({ 
      error: error.message || "Internal server error while generating code suggestion" 
    });
  }
});


app.post("/execute", async (req, res) => {
  console.log(req.body);
  
  try {
    // Prepare the payload for JDoodle API
    const payload = {
      clientId: req.body.clientId,
      clientSecret: req.body.clientSecret,
      script: req.body.script,
      language: req.body.language,
      versionIndex: "0", // Use default version
      stdin: req.body.stdin || "" // Include user input if provided
    };
    
    const response = await axios.post(
      "https://api.jdoodle.com/v1/execute",
      payload
    );
    res.json(response.data);
  } catch (error) {
    console.error("JDoodle API Error:", error.response?.data || error.message);
    res.status(error.response?.status || 500)
       .json(error.response?.data || { error: "Execution failed" });
  }
});



app.use("/api", router);