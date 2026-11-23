package common

// Error codes of the API responses.
const (
	// BadRequest is returned when the request body is not valid JSON.
	BadRequest = "BAD_REQUEST"
	// ValidationError is returned when a request field fails validation.
	ValidationError = "VALIDATION_ERROR"
	// AlreadyPublishing is returned when a run is already in progress.
	AlreadyPublishing = "ALREADY_PUBLISHING"
	// NotReady is returned by /readyz while the peer is starting.
	NotReady = "NOT_READY"
	// NotFound is returned for a path that the API does not have.
	NotFound = "NOT_FOUND"
	// MethodNotAllowed is returned for a method that the path does not accept.
	MethodNotAllowed = "METHOD_NOT_ALLOWED"
)

// Reasons of gs_publish_errors_total.
const (
	// ReasonEncode counts the messages that failed to encode.
	ReasonEncode = "encode"
	// ReasonPublish counts the messages that failed to publish to the topic.
	ReasonPublish = "publish"
)
