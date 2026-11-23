package utils

import (
	"encoding/json"
	"strings"

	"github.com/pkg/errors"

	"go-peer/common/types"
)

// EncodeMessage returns the JSON form of the message, padded with Payload so
// that the encoded message is size bytes. If size is smaller than the message
// without padding, the message is not padded.
func EncodeMessage(msg types.Message, size int) ([]byte, error) {
	msg.Payload = ""

	data, err := json.Marshal(msg)
	if err != nil {
		return nil, errors.Wrap(err, "encode message")
	}

	padding := size - len(data)
	if padding <= 0 {
		return data, nil
	}

	msg.Payload = strings.Repeat("x", padding)

	data, err = json.Marshal(msg)
	if err != nil {
		return nil, errors.Wrap(err, "encode message")
	}

	return data, nil
}
