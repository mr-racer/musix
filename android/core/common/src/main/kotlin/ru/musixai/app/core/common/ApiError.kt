package ru.musixai.app.core.common

/** An HTTP error with the server's status (401 after a failed refresh = signed out). */
class ApiError(val status: Int, message: String, cause: Throwable? = null) : Exception(message, cause)
