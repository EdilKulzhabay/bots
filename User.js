const mongoose = require("mongoose")

const UserSchema = new mongoose.Schema(
    {
        chatId: {
            type: String
        },
        language: {
            type: String,
            default: ""
        }
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", UserSchema);
