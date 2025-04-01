// socket.js
import { io } from "socket.io-client";

const options = {
};

const socket = io(process.env.REACT_APP_BACKEND_URL, options);

export const initSocket = () => {
  return socket;
};
// socket.js
// import { io } from "socket.io-client";

// const options = {
//   reconnection: true,
//   reconnectionAttempts: 5, 
//   reconnectionDelay: 2000, 
//   transports: ["websocket", "polling"], 
//   forceNew: false, 
//   autoConnect: true, 
// };

// const socket = io(process.env.REACT_APP_BACKEND_URL, options);

// export const initSocket = () => {
//   return socket;
// };

