"""Run a read-only workspace chat with the selected Crew coworker and provider."""

import asyncio
import json
import sys

from birbcrew import provider
from birbcrew.domain import Coworker
from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart, UserPromptPart,
)
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

USAGE = "usage: chat-agent.py --live|--local"


def local_inspection(messages, info):
    for part in messages[-1].parts:
        if isinstance(part, ToolReturnPart):
            return ModelResponse(parts=[TextPart(content=part.content)])
    return ModelResponse(parts=[ToolCallPart("inspect_factory", {})])


def select_model(mode, chat):
    """The gateway names the mode. Anything else is an error, never the local model."""
    if mode == "--local":
        return FunctionModel(local_inspection, model_name="birbforge-inspection")
    if mode != "--live":
        raise SystemExit(USAGE)
    key = chat.pop("providerKey", None)
    if not isinstance(key, str) or not key.strip():
        raise SystemExit("Live chat requires the provider credential.")
    return OpenAIChatModel(
        provider.MODEL, provider=OpenAIProvider(base_url=provider.ENDPOINT, api_key=key)
    )


async def main():
    if len(sys.argv) != 2:
        raise SystemExit(USAGE)
    chat = json.load(sys.stdin)
    profile = chat["agent"]
    model = select_model(sys.argv[1], chat)
    coworker = Coworker(
        id=profile["id"],
        instructions=profile["instructions"],
        tools=["inspect_factory"],
        eligible_models=[model.model_name],
    )
    agent = Agent(
        model,
        name=coworker.id,
        instructions=f"You are {profile['name']}. {coworker.instructions}",
    )

    @agent.tool_plain
    def inspect_factory() -> str:
        """Read this coworker's current workspace and assigned project status."""
        return chat["inspection"]

    history = []
    for turn in chat["turns"][:-1]:
        history.extend([
            ModelRequest(parts=[UserPromptPart(content=turn["text"])]),
            ModelResponse(parts=[TextPart(content=turn["answer"])]),
        ])
    result = await agent.run(
        chat["turns"][-1]["text"],
        message_history=history,
        model_settings=provider.model_settings(chat["id"]),
        usage_limits=UsageLimits(request_limit=4),
    )
    print(json.dumps(result.output))


if __name__ == "__main__":
    asyncio.run(main())
