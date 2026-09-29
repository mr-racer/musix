"""The base of every API model: camelCase on the wire, snake_case in Python."""

import datetime as dt
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


UUID_RE = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
# `?ids=a,b,c` batch reads: ≤ 200 comma-separated uuids
ID_LIST = {"pattern": f"^{UUID_RE}(,{UUID_RE}){{0,199}}$", "max_length": 200 * 37}


# JSON-exact scalars for request bodies. Pydantic's lax mode coerces "5" → 5, 1 → True
# and 0 → a datetime; strict mode would refuse 250.0 (an integer to JSON Schema) and, in
# FastAPI's python-mode validation, every RFC 3339 string. These accept exactly what the
# OpenAPI document says.
def _json_int(v: Any) -> Any:
    if isinstance(v, bool) or not isinstance(v, int | float):
        raise ValueError("must be an integer")
    return v


def _json_bool(v: Any) -> Any:
    if not isinstance(v, bool):
        raise ValueError("must be a boolean")
    return v


def _json_str(v: Any) -> Any:
    if not isinstance(v, str):
        raise ValueError("must be an RFC 3339 string")
    return v


JSON_INT = BeforeValidator(_json_int)  # after any Field constraints, so they stay JSON Schema
JsonInt = Annotated[int, JSON_INT]
JsonBool = Annotated[bool, BeforeValidator(_json_bool)]
JsonDatetime = Annotated[dt.datetime, BeforeValidator(_json_str)]
