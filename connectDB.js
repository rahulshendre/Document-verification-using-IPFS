import mongoose from "mongoose";

const connectDB = async () => {
    mongoose.connect(process.env.MONGO_URI).then(()=>{
    console.log("Database connected");
}).catch((e)=>{
    console.log(e.message);
})
}


export default connectDB;