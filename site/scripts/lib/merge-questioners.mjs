function uniqueTopics(items) {
  return Array.from(
    new Set((Array.isArray(items) ? items : []).map((item) => String(item ?? "").trim()).filter(Boolean))
  );
}

export function mergeQuestionersWithProvenance(structuredQuestioners, aiQuestioners) {
  const structured = Array.isArray(structuredQuestioners) ? structuredQuestioners : [];
  const generated = Array.isArray(aiQuestioners) ? aiQuestioners : [];

  if (structured.length === 0) {
    return generated.map((questioner) => ({
      name: questioner.name,
      topics: [],
      ai_topics: uniqueTopics(questioner.topics),
      topics_source: "ai_generated",
    }));
  }

  return structured.map((questioner) => {
    const questionerName = String(questioner?.name ?? "").trim();
    const topics = uniqueTopics(questioner.topics);
    const aiMatch = generated.find((candidate) => {
      const candidateName = String(candidate?.name ?? "").trim();
      return questionerName
        && candidateName
        && (candidateName.includes(questionerName) || questionerName.includes(candidateName));
    });
    return {
      name: questionerName,
      topics,
      ai_topics: uniqueTopics(aiMatch?.topics).filter((topic) => !topics.includes(topic)),
      topics_source: "minutes_structure",
    };
  });
}
