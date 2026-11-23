package utils

import "go-peer/common/types"

// SuccessResponse builds the body of a successful response.
func SuccessResponse(data interface{}, msg string) *types.APIResponse {
	return &types.APIResponse{
		Status:  "success",
		Data:    data,
		Message: msg,
	}
}

// ErrorResponse builds the body of a failed response with an error code.
func ErrorResponse(errCode string, err error, msg string) *types.APIResponse {
	return &types.APIResponse{
		Status: "failed",
		Error: &types.APIError{
			Code:    errCode,
			Message: err.Error(),
		},
		Message: msg,
	}
}
