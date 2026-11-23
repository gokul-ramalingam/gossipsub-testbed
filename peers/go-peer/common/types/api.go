package types

// APIError is the error part of a failed API response.
type APIError struct {
	Code    string `json:"code"`    // error code from common/constants.go
	Message string `json:"message"` // text of the underlying error
}

// APIResponse is the body of each JSON response. The JS peer uses the same fields.
type APIResponse struct {
	Status  string      `json:"status"`          // "success" or "failed"
	Data    interface{} `json:"data,omitempty"`  // response data, on success
	Error   *APIError   `json:"error,omitempty"` // error details, on failure
	Message string      `json:"message"`         // human-readable summary
}
