import mongoose from "mongoose";

const hashSchema = new mongoose.Schema({
    hash: {
        type: String,
        required: [true, "Please provide username"],
        unique: true,
    }
})

const Hash = mongoose.models.hashes || mongoose.model("hashes", hashSchema);


export default Hash;