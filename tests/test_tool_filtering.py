"""
Tests for tool filtering module.

Tests the MEMORY_JOURNAL_MCP_TOOL_FILTER environment variable parsing and filtering logic.
Covers filter syntax (-group, -tool, +tool), order of operations, edge cases,
and real-world usage scenarios.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))

from tool_filtering import (
    ALL_TOOLS,
    TOOL_GROUPS,
    clear_cache,
    filter_tools,
    get_all_tool_names,
    get_available_groups,
    get_included_tools,
    is_tool_enabled,
)


class TestToolFilteringBase:
    """Base class with setup/teardown for tool filtering tests."""

    def setup_method(self):
        """Reset environment and cache before each test."""
        self._original_filter = os.environ.get("MEMORY_JOURNAL_MCP_TOOL_FILTER")
        os.environ.pop("MEMORY_JOURNAL_MCP_TOOL_FILTER", None)
        clear_cache()

    def teardown_method(self):
        """Restore environment after each test."""
        if self._original_filter is not None:
            os.environ["MEMORY_JOURNAL_MCP_TOOL_FILTER"] = self._original_filter
        else:
            os.environ.pop("MEMORY_JOURNAL_MCP_TOOL_FILTER", None)
        clear_cache()

    def set_filter(self, value: str) -> None:
        """Helper to set filter and clear cache."""
        os.environ["MEMORY_JOURNAL_MCP_TOOL_FILTER"] = value
        clear_cache()


class TestToolGroups(TestToolFilteringBase):
    """Tests for TOOL_GROUPS constant structure."""

    def test_all_expected_groups_exist(self):
        """All expected groups should be defined."""
        expected = {
            "core",
            "search",
            "analytics",
            "relationships",
            "export",
            "admin",
            "test",
        }
        assert set(TOOL_GROUPS.keys()) == expected

    def test_core_group_has_essential_tools(self):
        """Core group should contain basic operations."""
        assert TOOL_GROUPS["core"] == {
            "create_entry",
            "search_entries",
            "get_recent_entries",
            "get_entry_by_id",
            "list_tags",
        }

    def test_all_tools_derived_from_groups(self):
        """ALL_TOOLS should be the union of all group tools."""
        expected = set().union(*TOOL_GROUPS.values())
        assert ALL_TOOLS == expected

    def test_no_duplicate_tools_across_groups(self):
        """Each tool should belong to exactly one group."""
        seen: set[str] = set()
        for group_name, tools in TOOL_GROUPS.items():
            duplicates = seen & tools
            assert not duplicates, f"Duplicate tools in '{group_name}': {duplicates}"
            seen |= tools

    def test_all_16_tools_accounted_for(self):
        """Should have exactly 16 tools total."""
        assert len(ALL_TOOLS) == 16


class TestNoFiltering(TestToolFilteringBase):
    """Tests when no filtering is configured."""

    @pytest.mark.parametrize("env_value", [None, "", "   ", "\t\n"])
    def test_no_filter_returns_empty_frozenset(self, env_value):
        """Empty/missing env var should return empty frozenset (no filtering)."""
        if env_value is not None:
            os.environ["MEMORY_JOURNAL_MCP_TOOL_FILTER"] = env_value
        clear_cache()

        assert get_included_tools() == frozenset()

    def test_all_tools_enabled_when_no_filter(self):
        """All tools should be enabled when no filter is set."""
        for tool in ALL_TOOLS:
            assert is_tool_enabled(tool) is True

    def test_filter_tools_returns_all_when_no_filter(self):
        """filter_tools should return all tools when no filter is set."""
        mock_tools = [MagicMock(name=n) for n in ["create_entry", "search_entries"]]
        for i, name in enumerate(["create_entry", "search_entries"]):
            mock_tools[i].name = name

        assert filter_tools(mock_tools) == mock_tools


class TestDisableGroup(TestToolFilteringBase):
    """Tests for disabling groups with -group syntax."""

    def test_disable_single_group(self):
        """Disabling a group should remove all its tools."""
        self.set_filter("-analytics")
        result = get_included_tools()

        assert not (result & TOOL_GROUPS["analytics"]), "Analytics tools should be excluded"
        assert TOOL_GROUPS["core"] <= result, "Core tools should remain"

    @pytest.mark.parametrize(
        "groups",
        [
            ["analytics", "test"],
            ["analytics", "test", "export"],
            ["admin", "test"],
        ],
    )
    def test_disable_multiple_groups(self, groups):
        """Disabling multiple groups should remove all their tools."""
        self.set_filter(",".join(f"-{g}" for g in groups))
        result = get_included_tools()

        for group in groups:
            assert not (
                result & TOOL_GROUPS[group]
            ), f"{group} tools should be excluded"

    def test_disable_all_groups_results_in_empty_set(self):
        """Disabling all groups should result in empty set."""
        self.set_filter(",".join(f"-{g}" for g in TOOL_GROUPS.keys()))
        assert get_included_tools() == frozenset()


class TestDisableTool(TestToolFilteringBase):
    """Tests for disabling individual tools with -tool syntax."""

    @pytest.mark.parametrize("tool", ["delete_entry", "create_entry", "semantic_search"])
    def test_disable_single_tool(self, tool):
        """Disabling a single tool should only remove that tool."""
        self.set_filter(f"-{tool}")
        result = get_included_tools()

        assert tool not in result
        assert len(result) == len(ALL_TOOLS) - 1

    def test_disable_multiple_tools(self):
        """Disabling multiple tools should remove all of them."""
        self.set_filter("-delete_entry,-create_entry,-export_entries")
        result = get_included_tools()

        assert "delete_entry" not in result
        assert "create_entry" not in result
        assert "export_entries" not in result
        assert len(result) == len(ALL_TOOLS) - 3


class TestEnableTool(TestToolFilteringBase):
    """Tests for re-enabling tools with +tool syntax."""

    def test_enable_tool_after_group_disable(self):
        """Re-enabling a tool after disabling its group should work."""
        self.set_filter("-admin,+update_entry")
        result = get_included_tools()

        assert "update_entry" in result
        assert not (result & (TOOL_GROUPS["admin"] - {"update_entry"}))

    def test_enable_multiple_tools_after_group_disable(self):
        """Re-enabling multiple tools after group disable should work."""
        self.set_filter("-core,+create_entry,+search_entries")
        result = get_included_tools()

        assert {"create_entry", "search_entries"} <= result
        remaining_core = TOOL_GROUPS["core"] - {
            "create_entry",
            "search_entries",
        }
        assert not (result & remaining_core)

    def test_enable_already_enabled_tool_is_noop(self):
        """Enabling an already-enabled tool should be a no-op."""
        self.set_filter("+create_entry")
        result = get_included_tools()

        assert "create_entry" in result
        assert len(result) == len(ALL_TOOLS)


class TestOrderOfOperations(TestToolFilteringBase):
    """Tests for left-to-right processing order."""

    @pytest.mark.parametrize(
        "filter_str,tool,expected",
        [
            ("-admin,+update_entry", "update_entry", True),  # disable then enable
            (
                "+update_entry,-admin",
                "update_entry",
                False,
            ),  # enable then disable
            (
                "-test,+test_simple,-test_simple",
                "test_simple",
                False,
            ),  # complex
        ],
    )
    def test_order_matters(self, filter_str, tool, expected):
        """Filter rules should process left-to-right."""
        self.set_filter(filter_str)
        assert is_tool_enabled(tool) is expected


class TestInvalidInput(TestToolFilteringBase):
    """Tests for handling invalid input."""

    @pytest.mark.parametrize(
        "filter_str",
        [
            "-nonexistent_group",
            "-nonexistent_tool",
            "+nonexistent_tool",
            "create_entry",  # missing prefix
        ],
    )
    def test_invalid_rules_ignored(self, filter_str):
        """Invalid rules should be ignored, all tools remain enabled."""
        self.set_filter(filter_str)
        assert len(get_included_tools()) == len(ALL_TOOLS)

    def test_mixed_valid_and_invalid_rules(self):
        """Valid rules should work even with invalid ones present."""
        self.set_filter("-analytics,invalid,+create_entry,-nonexistent")
        result = get_included_tools()

        assert not (result & TOOL_GROUPS["analytics"])
        assert "create_entry" in result


class TestWhitespaceHandling(TestToolFilteringBase):
    """Tests for whitespace handling in filter rules."""

    @pytest.mark.parametrize(
        "filter_str",
        [
            "  -analytics  ,  -test  ",
            "-analytics,,-test",
            " -analytics , , -test ",
        ],
    )
    def test_whitespace_and_empty_rules_handled(self, filter_str):
        """Whitespace should be trimmed, empty rules ignored."""
        self.set_filter(filter_str)
        result = get_included_tools()

        assert not (result & TOOL_GROUPS["analytics"])
        assert not (result & TOOL_GROUPS["test"])


class TestIsToolEnabled(TestToolFilteringBase):
    """Tests for is_tool_enabled function."""

    def test_enabled_tool_returns_true(self):
        self.set_filter("-analytics")
        assert is_tool_enabled("create_entry") is True

    def test_disabled_tool_returns_false(self):
        self.set_filter("-analytics")
        assert is_tool_enabled("get_statistics") is False

    def test_unknown_tool_when_no_filter(self):
        """Unknown tool returns True when no filter is set."""
        assert is_tool_enabled("unknown_tool") is True

    def test_unknown_tool_when_filter_active(self):
        """Unknown tool returns False when filter is active (not in included set)."""
        self.set_filter("-analytics")
        assert is_tool_enabled("unknown_tool") is False


class TestFilterTools(TestToolFilteringBase):
    """Tests for filter_tools function."""

    def test_filters_tool_list(self):
        """filter_tools should filter MCP Tool objects by name."""
        self.set_filter("-analytics")

        mock_tools = []
        for name in ["create_entry", "get_statistics", "search_entries"]:
            tool = MagicMock()
            tool.name = name
            mock_tools.append(tool)

        result = filter_tools(mock_tools)
        result_names = [t.name for t in result]

        assert result_names == ["create_entry", "search_entries"]

    def test_preserves_order(self):
        """filter_tools should preserve order of tools."""
        self.set_filter("-analytics")

        mock_tools = []
        for name in ["search_entries", "create_entry", "list_tags"]:
            tool = MagicMock()
            tool.name = name
            mock_tools.append(tool)

        result_names = [t.name for t in filter_tools(mock_tools)]
        assert result_names == ["search_entries", "create_entry", "list_tags"]


class TestCaching(TestToolFilteringBase):
    """Tests for LRU cache behavior."""

    def test_cache_returns_same_object(self):
        """Cached result should be the same object on subsequent calls."""
        self.set_filter("-analytics")
        result1 = get_included_tools()
        result2 = get_included_tools()
        assert result1 is result2

    def test_clear_cache_allows_new_result(self):
        """Clearing cache should compute new result."""
        self.set_filter("-analytics")
        result1 = get_included_tools()

        self.set_filter("-test")
        result2 = get_included_tools()

        assert "get_statistics" not in result1
        assert "get_statistics" in result2


class TestHelperFunctions(TestToolFilteringBase):
    """Tests for helper/utility functions."""

    def test_get_available_groups_returns_copy(self):
        """get_available_groups should return a copy, not the original."""
        groups = get_available_groups()
        groups["test_group"] = set()
        assert "test_group" not in TOOL_GROUPS

    def test_get_all_tool_names_returns_copy(self):
        """get_all_tool_names should return a copy, not the original."""
        tools = get_all_tool_names()
        tools.add("test_tool")
        assert "test_tool" not in ALL_TOOLS


class TestRealWorldScenarios(TestToolFilteringBase):
    """Tests for real-world usage scenarios."""

    def test_windsurf_100_tool_limit(self):
        """Reduce tools to stay under Windsurf's 100-tool limit."""
        self.set_filter("-test,-admin")
        result = get_included_tools()

        assert len(result) < len(ALL_TOOLS)
        assert {"create_entry", "search_entries", "list_tags"} <= result

    def test_read_only_mode(self):
        """Read-only mode by disabling admin tools."""
        self.set_filter("-admin")
        result = get_included_tools()

        assert "update_entry" not in result
        assert "delete_entry" not in result
        assert {"create_entry", "search_entries", "get_entry_by_id"} <= result

    def test_minimal_core_only(self):
        """Only core tools."""
        non_core = [g for g in TOOL_GROUPS.keys() if g != "core"]
        self.set_filter(",".join(f"-{g}" for g in non_core))

        assert get_included_tools() == frozenset(TOOL_GROUPS["core"])

    def test_admin_with_specific_tools(self):
        """Disable admin but keep update_entry."""
        self.set_filter("-admin,+update_entry")
        result = get_included_tools()

        assert "update_entry" in result
        assert "delete_entry" not in result

    def test_production_mode(self):
        """Production mode - disable test tools."""
        self.set_filter("-test")
        result = get_included_tools()

        assert "test_simple" not in result
        assert "create_entry_minimal" not in result
        assert len(result) == len(ALL_TOOLS) - 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
