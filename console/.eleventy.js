module.exports = function (eleventyConfig) {
    eleventyConfig.addPassthroughCopy("console/src/media");
    eleventyConfig.addPassthroughCopy("console/src/styles");
    eleventyConfig.addPassthroughCopy("console/src/scripts");

    return {
        dir: {
            input: "console/src",
            output: "dist/console",
            includes: "_includes",
        },
        pathPrefix: "/console/",
        htmlTemplateEngine: "njk",
        markdownTemplateEngine: "njk",
    };
};
